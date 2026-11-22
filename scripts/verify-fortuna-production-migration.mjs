import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

const migrationPath = process.env.FORTUNA_MIGRATION_SQL_FILE;
if (!migrationPath) throw new Error('FORTUNA_MIGRATION_SQL_FILE is required');
const migrationSql = await readFile(migrationPath, 'utf8');
assert.match(migrationSql, /^BEGIN;[\s\S]*COMMIT;\s*$/i);

const windowsPgCtl = process.platform === 'win32' ? await import('@embedded-postgres/windows-x64') : null;
const pgCtlPath = windowsPgCtl?.pg_ctl ?? null;
const databaseDir = await mkdtemp(path.join(tmpdir(), 'fortuna-migration-pg17-'));
const password = 'fortuna-migration-test-only';
const clients = [];
let postgres;
let postgresStarted = false;

async function removeWithRetry(directory, attempts = 20) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY', 'EMFILE', 'ENFILE'].includes(error?.code)) throw error;
      if (i + 1 < attempts) await delay(250);
    }
  }
  throw lastError;
}

async function stopPostgres() {
  if (!pgCtlPath) throw new Error('Windows pg_ctl is required for graceful native PostgreSQL shutdown');
  const child = spawn(pgCtlPath, ['stop', '-D', databaseDir, '-m', 'fast', '-w', '-t', '30'], {
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', chunk => { stdout += chunk; });
  child.stderr?.on('data', chunk => { stderr += chunk; });
  const result = await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('pg_ctl shutdown timed out'));
    }, 45000);
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  if (result.code !== 0) {
    throw new Error('pg_ctl failed (' + result.code + '): ' + [stdout.trim(), stderr.trim()].filter(Boolean).join(' | '));
  }
  console.log('PASS — PostgreSQL 17.11 stopped gracefully');
}

function addClient(name, port) {
  const client = new Client({
    host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres',
    application_name: name, connectionTimeoutMillis: 20000, query_timeout: 30000, ssl: false,
  });
  clients.push(client);
  return client;
}
async function connect(name, port) {
  const client = addClient(name, port);
  await client.connect();
  return client;
}
function asJson(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
async function call(client, sql, params = []) {
  const result = await client.query(sql, params);
  return asJson(result.rows[0].value);
}
async function expectFailure(operation, pattern, label) {
  let error;
  try { await operation(); } catch (caught) { error = caught; }
  assert.ok(error, label + ': expected failure');
  assert.match(String(error.message || error), pattern, label);
  console.log('PASS — ' + label);
}
async function authenticate(client, userId) {
  await client.query('RESET ROLE');
  await client.query('SET ROLE authenticated');
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

const probe = net.createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));

try {
  postgres = new EmbeddedPostgres({
    databaseDir, user: 'postgres', password, port, persistent: true, autoRehydrateSymlinks: true,
    onLog: () => {}, onError: error => { process.stderr.write(String(error) + '\n'); },
  });
  await postgres.initialise();
  await postgres.start();
  postgresStarted = true;
  const admin = await connect('fortuna-production-migration-admin', port);
  const version = (await admin.query('SELECT version() AS version')).rows[0].version;
  assert.match(version, /PostgreSQL 17\.11(?:\.|\s)/i);

  await admin.query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.perfiles (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid()
    RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog
    AS $auth_uid_test_shim$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $auth_uid_test_shim$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
  `);
  console.log('PASS — test-only Auth subject shim prepared before the production migration');

  await admin.query(migrationSql);
  console.log('PASS — actual FORTUNA production migration applied to isolated PostgreSQL 17.11');

  const ownerA = '10000000-0000-4000-8000-000000000001';
  const ownerB = '10000000-0000-4000-8000-000000000002';
  await admin.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [ownerA, ownerB]);
  const a = await connect('fortuna-migration-owner-a', port);
  const b = await connect('fortuna-migration-owner-b', port);
  await authenticate(a, ownerA);
  await authenticate(b, ownerB);

  const contactA = await call(a,
    'SELECT api.create_contact($1, NULL, NULL, $2) AS value',
    ['Migration owner A', 'migration-contact-a-001']);
  assert.ok(contactA.contact_id);
  const opened = await call(a,
    'SELECT api.open_obligation($1, $2, $3, $4, $5, $6::timestamptz, $7) AS value',
    [contactA.contact_id, 'receivable', 'CUP', '16500', 'Préstamo inicial',
      '2026-12-31T00:00:00Z', 'migration-open-obligation-001']);
  assert.ok(opened.obligation_id);

  const initial = await call(a, 'SELECT api.list_obligations($1, $2, $3) AS value',
    [contactA.contact_id, 'CUP', null]);
  assert.equal(initial.length, 1);
  assert.equal(initial[0].description, 'Préstamo inicial');
  assert.equal(initial[0].principal_minor, '16500');
  assert.equal(initial[0].remaining_minor, '16500');
  assert.equal(initial[0].direction, 'receivable');
  assert.equal(initial[0].currency, 'CUP');
  assert.ok(Object.hasOwn(initial[0], 'due_at'));
  assert.ok(Object.hasOwn(initial[0], 'created_at'));
  assert.equal((await call(a, 'SELECT api.list_obligations($1, $2, $3) AS value',
    [contactA.contact_id, 'EUR', null])).length, 0);
  await expectFailure(
    () => call(a, 'SELECT api.list_obligations($1, $2, $3) AS value',
      [contactA.contact_id, 'CUP', 'invalid']),
    /fortuna_obligation_direction_invalid/i, 'production query rejects invalid direction filter');
  await expectFailure(
    () => call(a, 'SELECT api.list_obligations($1, $2, $3) AS value',
      [contactA.contact_id, 'GBP', null]),
    /fortuna_currency_not_supported/i, 'production query rejects unsupported currency filter');
  console.log('PASS — detailed obligation fields and optional query filters');

  await call(b, 'SELECT api.create_contact($1, NULL, NULL, $2) AS value',
    ['Owner B private book', 'migration-contact-b-001']);
  await expectFailure(
    () => call(b, 'SELECT api.list_obligations($1, NULL, NULL) AS value', [contactA.contact_id]),
    /fortuna_contact_not_found/i, 'owner B cannot enumerate owner A obligation details');
  await expectFailure(
    () => b.query('SELECT count(*) FROM fortuna_private.financial_contacts'),
    /permission denied/i, 'authenticated cannot read private tables directly');

  const anon = await connect('fortuna-migration-anon', port);
  await anon.query('SET ROLE anon');
  await expectFailure(
    () => anon.query('SELECT api.list_obligations($1, NULL, NULL)', [contactA.contact_id]),
    /permission denied/i, 'anon cannot access the FORTUNA API schema');

  const preview = await call(a,
    "SELECT api.preview_settlement($1, 'CUP', 'cash_received', 'fifo', $2, '[]'::jsonb) AS value",
    [contactA.contact_id, '5000']);
  assert.ok(preview.preview_fingerprint);
  const received = await call(a,
    "SELECT api.receive_cash($1, 'CUP', 'fifo', $2, '[]'::jsonb, $3, false, $4) AS value",
    [contactA.contact_id, '5000', preview.preview_fingerprint, 'migration-settlement-001']);
  assert.ok(received.event_id);
  const after = await call(a, 'SELECT api.list_obligations($1, $2, $3) AS value',
    [contactA.contact_id, 'CUP', 'receivable']);
  assert.equal(after.length, 1);
  assert.equal(after[0].principal_minor, '16500');
  assert.equal(after[0].remaining_minor, '11500');

  const reconcile = await admin.query(
    'SELECT e.total_amount_minor, COALESCE(sum(l.signed_minor), 0)::bigint AS ledger_total FROM fortuna_private.financial_events e JOIN fortuna_private.financial_ledger_entries l ON l.book_id=e.book_id AND l.event_id=e.id WHERE e.id=$1 GROUP BY e.id',
    [received.event_id]);
  assert.equal(Number(reconcile.rows[0].total_amount_minor), 5000);
  assert.equal(BigInt(reconcile.rows[0].ledger_total), -5000n);
  console.log('PASS — partial settlement recalculates remaining balance and ledger reconciles to the cash event');

  const grants = await admin.query(`
    SELECT
      has_table_privilege('authenticated', 'fortuna_private.financial_contacts', 'SELECT') AS authenticated_select,
      has_table_privilege('anon', 'fortuna_private.financial_contacts', 'SELECT') AS anon_select,
      has_function_privilege('authenticated', 'api.list_obligations(uuid,text,text)', 'EXECUTE') AS authenticated_rpc,
      has_function_privilege('anon', 'api.list_obligations(uuid,text,text)', 'EXECUTE') AS anon_rpc
  `);
  assert.equal(grants.rows[0].authenticated_select, false);
  assert.equal(grants.rows[0].anon_select, false);
  assert.equal(grants.rows[0].authenticated_rpc, true);
  assert.equal(grants.rows[0].anon_rpc, false);
  console.log('PASS — authenticated has exact query EXECUTE; anon and direct table access remain denied');
  console.log('PASS — complete production migration integration suite');
} finally {
  for (const client of clients) { try { await client.end(); } catch {} }
  if (postgresStarted && postgres) {
    if (process.platform === 'win32') await stopPostgres();
    else await postgres.stop();
  }
  await removeWithRetry(databaseDir);
}
