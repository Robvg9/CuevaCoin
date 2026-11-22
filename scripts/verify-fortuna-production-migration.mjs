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
assert.match(migrationSql, /BEGIN;[\s\S]*COMMIT;\s*$/i);

const fkIndexMigrationPath = process.env.FORTUNA_FK_INDEX_MIGRATION_SQL_FILE;
if (!fkIndexMigrationPath) throw new Error('FORTUNA_FK_INDEX_MIGRATION_SQL_FILE is required');
const fkIndexMigrationSql = await readFile(fkIndexMigrationPath, 'utf8');
assert.match(fkIndexMigrationSql, /BEGIN;[\s\S]*COMMIT;\s*$/i);
assert.equal((fkIndexMigrationSql.match(/CREATE INDEX IF NOT EXISTS/gi) || []).length, 14,
  'FORTUNA FK migration must add exactly fourteen indexes');
assert.doesNotMatch(fkIndexMigrationSql, /\bCREATE\s+TABLE\b|\bALTER\s+TABLE\b|\bDROP\s+TABLE\b|\bTRUNCATE\b|\bGRANT\b|\bREVOKE\b|\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/i,
  'FORTUNA FK migration must remain index-only');
const expectedFkIndexes = [
  { name: 'financial_allocations_book_event_contact_currency_fk_idx', table: 'financial_allocations', columns: ['book_id', 'event_id', 'contact_id', 'currency_code'] },
  { name: 'financial_allocations_book_obligation_contact_currency_fk_idx', table: 'financial_allocations', columns: ['book_id', 'obligation_id', 'contact_id', 'currency_code'] },
  { name: 'financial_audit_actor_user_fk_idx', table: 'financial_audit', columns: ['actor_user_id'] },
  { name: 'financial_audit_book_event_fk_idx', table: 'financial_audit', columns: ['book_id', 'event_id'] },
  { name: 'financial_contacts_linked_profile_fk_idx', table: 'financial_contacts', columns: ['linked_profile_id'] },
  { name: 'financial_events_actor_user_fk_idx', table: 'financial_events', columns: ['actor_user_id'] },
  { name: 'financial_events_book_reversal_contact_currency_fk_idx', table: 'financial_events', columns: ['book_id', 'reverses_event_id', 'contact_id', 'currency_code'] },
  { name: 'financial_events_currency_fk_idx', table: 'financial_events', columns: ['currency_code'] },
  { name: 'financial_idempotency_actor_user_fk_idx', table: 'financial_idempotency', columns: ['actor_user_id'] },
  { name: 'financial_idempotency_book_event_fk_idx', table: 'financial_idempotency', columns: ['book_id', 'event_id'] },
  { name: 'financial_ledger_book_event_contact_currency_fk_idx', table: 'financial_ledger_entries', columns: ['book_id', 'event_id', 'contact_id', 'currency_code'] },
  { name: 'financial_ledger_book_obligation_contact_currency_fk_idx', table: 'financial_ledger_entries', columns: ['book_id', 'obligation_id', 'contact_id', 'currency_code'] },
  { name: 'financial_obligations_created_by_fk_idx', table: 'financial_obligations', columns: ['created_by'] },
  { name: 'financial_obligations_currency_fk_idx', table: 'financial_obligations', columns: ['currency_code'] },
];

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
async function waitForLock(observer, pid, label) {
  const deadline = Date.now() + 15000;
  let lastActivity = null;
  while (Date.now() < deadline) {
    const result = await observer.query(
      'SELECT state, wait_event_type, wait_event, query FROM pg_stat_activity WHERE pid = $1',
      [pid],
    );
    lastActivity = result.rows[0] || null;
    if (lastActivity?.wait_event_type === 'Lock') {
      assert.equal(lastActivity.state, 'active', label + ': blocked backend must remain active');
      return lastActivity;
    }
    if (!lastActivity || lastActivity.state === 'idle') {
      throw new Error(label + ': contender returned before a PostgreSQL lock wait was observed');
    }
    await delay(25);
  }
  throw new Error(label + ': timed out waiting for a real PostgreSQL lock; last activity=' + JSON.stringify(lastActivity));
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
    CREATE TABLE public.perfiles (id uuid PRIMARY KEY, es_admin boolean NOT NULL DEFAULT false, estado text NOT NULL DEFAULT 'activo');
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

  const indexCountBefore = Number((await admin.query(
    "SELECT count(*)::int AS count FROM pg_index i JOIN pg_class tbl ON tbl.oid=i.indrelid JOIN pg_namespace ns ON ns.oid=tbl.relnamespace WHERE ns.nspname='fortuna_private'"
  )).rows[0].count);
  const publicIndexCountBefore = Number((await admin.query(
    "SELECT count(*)::int AS count FROM pg_index i JOIN pg_class tbl ON tbl.oid=i.indrelid JOIN pg_namespace ns ON ns.oid=tbl.relnamespace WHERE ns.nspname='public'"
  )).rows[0].count);
  const privateRowsBefore = (await admin.query(`
    SELECT
      (SELECT count(*)::int FROM fortuna_private.financial_books) AS books,
      (SELECT count(*)::int FROM fortuna_private.financial_contacts) AS contacts,
      (SELECT count(*)::int FROM fortuna_private.financial_currencies) AS currencies,
      (SELECT count(*)::int FROM fortuna_private.financial_obligations) AS obligations,
      (SELECT count(*)::int FROM fortuna_private.financial_events) AS events,
      (SELECT count(*)::int FROM fortuna_private.financial_ledger_entries) AS ledger_entries,
      (SELECT count(*)::int FROM fortuna_private.financial_allocations) AS allocations,
      (SELECT count(*)::int FROM fortuna_private.financial_idempotency) AS idempotency,
      (SELECT count(*)::int FROM fortuna_private.financial_audit) AS audit
  `)).rows[0];
  await admin.query(fkIndexMigrationSql);
  const indexCountAfter = Number((await admin.query(
    "SELECT count(*)::int AS count FROM pg_index i JOIN pg_class tbl ON tbl.oid=i.indrelid JOIN pg_namespace ns ON ns.oid=tbl.relnamespace WHERE ns.nspname='fortuna_private'"
  )).rows[0].count);
  const publicIndexCountAfter = Number((await admin.query(
    "SELECT count(*)::int AS count FROM pg_index i JOIN pg_class tbl ON tbl.oid=i.indrelid JOIN pg_namespace ns ON ns.oid=tbl.relnamespace WHERE ns.nspname='public'"
  )).rows[0].count);
  const privateRowsAfter = (await admin.query(`
    SELECT
      (SELECT count(*)::int FROM fortuna_private.financial_books) AS books,
      (SELECT count(*)::int FROM fortuna_private.financial_contacts) AS contacts,
      (SELECT count(*)::int FROM fortuna_private.financial_currencies) AS currencies,
      (SELECT count(*)::int FROM fortuna_private.financial_obligations) AS obligations,
      (SELECT count(*)::int FROM fortuna_private.financial_events) AS events,
      (SELECT count(*)::int FROM fortuna_private.financial_ledger_entries) AS ledger_entries,
      (SELECT count(*)::int FROM fortuna_private.financial_allocations) AS allocations,
      (SELECT count(*)::int FROM fortuna_private.financial_idempotency) AS idempotency,
      (SELECT count(*)::int FROM fortuna_private.financial_audit) AS audit
  `)).rows[0];
  assert.equal(publicIndexCountAfter, publicIndexCountBefore,
    'Index-only FORTUNA migration must not alter any public-schema index');
  assert.deepEqual(privateRowsAfter, privateRowsBefore,
    'Index-only FORTUNA migration must not insert or modify financial rows');
  assert.equal(indexCountAfter - indexCountBefore, expectedFkIndexes.length,
    'Index-only migration must create exactly fourteen new private indexes');

  const expectedNames = expectedFkIndexes.map(item => item.name);
  const actualIndexes = await admin.query(`
    SELECT
      index_class.relname AS index_name,
      table_class.relname AS table_name,
      access_method.amname AS access_method,
      index_data.indisvalid AS is_valid,
      index_data.indisready AS is_ready,
      index_data.indpred IS NULL AS is_not_partial,
      ARRAY(
        SELECT attribute.attname::text
        FROM unnest(index_data.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, ord)
        JOIN pg_attribute attribute
          ON attribute.attrelid = index_data.indrelid
         AND attribute.attnum = key_column.attnum
        WHERE key_column.ord <= index_data.indnkeyatts
        ORDER BY key_column.ord
      ) AS key_columns
    FROM pg_index index_data
    JOIN pg_class index_class ON index_class.oid = index_data.indexrelid
    JOIN pg_class table_class ON table_class.oid = index_data.indrelid
    JOIN pg_namespace schema_class ON schema_class.oid = table_class.relnamespace
    JOIN pg_am access_method ON access_method.oid = index_class.relam
    WHERE schema_class.nspname = 'fortuna_private'
      AND index_class.relname = ANY($1::text[])
  `, [expectedNames]);
  assert.equal(actualIndexes.rows.length, expectedFkIndexes.length,
    'All fourteen named covering indexes must exist exactly once');
  for (const expected of expectedFkIndexes) {
    const matches = actualIndexes.rows.filter(row => row.index_name === expected.name);
    assert.equal(matches.length, 1, 'Expected one index named ' + expected.name);
    const actual = matches[0];
    assert.equal(actual.table_name, expected.table, expected.name + ' table');
    assert.equal(actual.access_method, 'btree', expected.name + ' access method');
    assert.equal(actual.is_valid, true, expected.name + ' must be valid');
    assert.equal(actual.is_ready, true, expected.name + ' must be ready');
    assert.equal(actual.is_not_partial, true, expected.name + ' must not be partial');
    assert.deepEqual(actual.key_columns, expected.columns, expected.name + ' ordered key columns');
    const duplicate = await admin.query(`
      SELECT count(*)::int AS count
      FROM pg_index other_index
      JOIN pg_class other_class ON other_class.oid = other_index.indexrelid
      WHERE other_index.indrelid = to_regclass('fortuna_private.' || $1)
        AND other_class.relname <> $2
        AND other_index.indisvalid
        AND other_index.indpred IS NULL
        AND other_index.indnkeyatts = cardinality($3::text[])
        AND ARRAY(
          SELECT attribute.attname::text
          FROM unnest(other_index.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, ord)
          JOIN pg_attribute attribute
            ON attribute.attrelid = other_index.indrelid
           AND attribute.attnum = key_column.attnum
          WHERE key_column.ord <= other_index.indnkeyatts
          ORDER BY key_column.ord
        ) = $3::text[]
    `, [expected.table, expected.name, expected.columns]);
    assert.equal(duplicate.rows[0].count, 0, expected.name + ' must not duplicate an existing exact-key index');
  }

  const uncoveredForeignKeys = await admin.query(`
    SELECT constraint_row.conname
    FROM pg_constraint constraint_row
    JOIN pg_class table_class ON table_class.oid = constraint_row.conrelid
    JOIN pg_namespace schema_class ON schema_class.oid = table_class.relnamespace
    WHERE constraint_row.contype = 'f'
      AND schema_class.nspname = 'fortuna_private'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index index_data
        JOIN pg_class index_class ON index_class.oid = index_data.indexrelid
        JOIN pg_am access_method ON access_method.oid = index_class.relam
        WHERE index_data.indrelid = constraint_row.conrelid
          AND access_method.amname = 'btree'
          AND index_data.indisvalid
          AND index_data.indisready
          AND index_data.indpred IS NULL
          AND index_data.indnkeyatts >= cardinality(constraint_row.conkey)
          AND (
            SELECT array_agg(key_column.attnum::smallint ORDER BY key_column.ord)
            FROM unnest(index_data.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, ord)
            WHERE key_column.ord <= cardinality(constraint_row.conkey)
          ) = constraint_row.conkey
      )
    ORDER BY constraint_row.conname
  `);
  assert.deepEqual(uncoveredForeignKeys.rows, [],
    'Every FORTUNA private foreign key must have a valid B-tree left-prefix covering index');
  console.log('PASS — exact fourteen FORTUNA covering indexes exist with ordered B-tree keys, valid/ready state and no exact duplicates');
  console.log('PASS — all FORTUNA private foreign keys have a left-prefix-compatible covering index');

  console.log('PASS — owner B is explicitly seeded as an active global CuevaCoin administrator for non-bypass testing');

  const ownerA = '10000000-0000-4000-8000-000000000001';
  const ownerB = '10000000-0000-4000-8000-000000000002';
  await admin.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [ownerA, ownerB]);
  await admin.query('INSERT INTO public.perfiles (id, es_admin, estado) VALUES ($1, false, $3), ($2, true, $3)', [ownerA, ownerB, 'activo']);
  assert.equal((await admin.query('SELECT es_admin FROM public.perfiles WHERE id = $1', [ownerB])).rows[0].es_admin, true);
  const a = await connect('fortuna-migration-owner-a', port);
  const b = await connect('fortuna-migration-owner-b', port);
  await authenticate(a, ownerA);
  await authenticate(b, ownerB);

  const apiSchemaClosed = await admin.query(`
    SELECT
      has_schema_privilege('authenticated', 'api', 'USAGE') AS authenticated_api_schema,
      has_schema_privilege('authenticated', 'fortuna_private', 'USAGE') AS authenticated_private_schema,
      has_schema_privilege('anon', 'api', 'USAGE') AS anon_api_schema,
      has_schema_privilege('anon', 'fortuna_private', 'USAGE') AS anon_private_schema
  `);
  assert.equal(apiSchemaClosed.rows[0].authenticated_api_schema, false);
  assert.equal(apiSchemaClosed.rows[0].authenticated_private_schema, false);
  assert.equal(apiSchemaClosed.rows[0].anon_api_schema, false);
  assert.equal(apiSchemaClosed.rows[0].anon_private_schema, false);
  await expectFailure(
    () => a.query('SELECT api.create_contact($1, NULL, NULL, $2)',
      ['API schema must remain closed', 'migration-api-closed-probe']),
    /permission denied for schema api/i,
    'production migration leaves the API schema closed until its separate release gate',
  );
  // The isolated harness opens the schema only after proving the production
  // migration does not. This enables integration coverage of the owner RPCs.
  await admin.query('GRANT USAGE ON SCHEMA api TO authenticated');
  await admin.query('GRANT USAGE ON SCHEMA fortuna_private TO authenticated');
  console.log('PASS — test harness temporarily opens both schemas only after verifying the production migration keeps them closed');

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

  // Run concurrency tests against the deployed migration itself (not the SQL prototypes).
  const a2 = await connect('fortuna-migration-owner-a-concurrent', port);
  await authenticate(a2, ownerA);

  const staleContact = await call(a, 'SELECT api.create_contact($1, NULL, NULL, $2) AS value',
    ['Migration stale preview contact', 'migration-stale-contact-001']);
  const staleObligation = await call(a,
    'SELECT api.open_obligation($1, $2, $3, $4, $5, NULL, $6) AS value',
    [staleContact.contact_id, 'receivable', 'CUP', '10000', 'Stale preview race',
      'migration-stale-obligation-001']);
  const stalePreview = await call(a,
    "SELECT api.preview_settlement($1, 'CUP', 'cash_received', 'fifo', $2, '[]'::jsonb) AS value",
    [staleContact.contact_id, '6000']);

  await a.query('BEGIN');
  const firstStaleCommit = await call(a,
    "SELECT api.receive_cash($1, 'CUP', 'fifo', $2, '[]'::jsonb, $3, false, $4) AS value",
    [staleContact.contact_id, '6000', stalePreview.preview_fingerprint, 'migration-stale-confirm-a01']);
  const staleContenderPid = (await a2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const staleContender = call(a2,
    "SELECT api.receive_cash($1, 'CUP', 'fifo', $2, '[]'::jsonb, $3, false, $4) AS value",
    [staleContact.contact_id, '6000', stalePreview.preview_fingerprint, 'migration-stale-confirm-b01']);
  let staleWait;
  try {
    staleWait = await waitForLock(admin, staleContenderPid, 'production migration stale-preview serialization');
  } catch (error) {
    await a.query('ROLLBACK');
    await staleContender.catch(() => {});
    throw error;
  }
  assert.match(staleWait.query, /api\.receive_cash/i);
  await a.query('COMMIT');
  await expectFailure(
    () => staleContender,
    /fortuna_stale_preview/i,
    'second production-migration confirmation using a stale preview is rejected after the first commit',
  );
  const staleCheck = await admin.query(
    `SELECT
       (SELECT count(*)::int FROM fortuna_private.financial_events WHERE contact_id = $1 AND event_type = 'cash_received') AS cash_events,
       (SELECT count(*)::int FROM fortuna_private.financial_idempotency WHERE idempotency_key IN ($2, $3)) AS idempotency_rows,
       (SELECT COALESCE(sum(signed_minor), 0)::bigint FROM fortuna_private.financial_ledger_entries WHERE obligation_id = $4) AS remaining`,
    [staleContact.contact_id, 'migration-stale-confirm-a01', 'migration-stale-confirm-b01', staleObligation.obligation_id],
  );
  assert.equal(staleCheck.rows[0].cash_events, 1);
  assert.equal(staleCheck.rows[0].idempotency_rows, 1, 'stale failure must roll back its idempotency reservation');
  assert.equal(BigInt(staleCheck.rows[0].remaining), 4000n);
  assert.ok(firstStaleCommit.event_id);
  console.log('PASS — production migration serializes competing confirmations and rolls back stale request reservation');

  const replayContact = await call(a, 'SELECT api.create_contact($1, NULL, NULL, $2) AS value',
    ['Migration idempotency replay contact', 'migration-replay-contact-001']);
  const replayObligation = await call(a,
    'SELECT api.open_obligation($1, $2, $3, $4, $5, NULL, $6) AS value',
    [replayContact.contact_id, 'receivable', 'CUP', '10000', 'Idempotency replay race',
      'migration-replay-obligation-001']);
  const replayPreview = await call(a,
    "SELECT api.preview_settlement($1, 'CUP', 'cash_received', 'fifo', $2, '[]'::jsonb) AS value",
    [replayContact.contact_id, '4000']);

  await a.query('BEGIN');
  const replayOriginal = await call(a,
    "SELECT api.receive_cash($1, 'CUP', 'fifo', $2, '[]'::jsonb, $3, false, $4) AS value",
    [replayContact.contact_id, '4000', replayPreview.preview_fingerprint, 'migration-replay-key-001']);
  const replayContenderPid = (await a2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const replayContender = call(a2,
    "SELECT api.receive_cash($1, 'CUP', 'fifo', $2, '[]'::jsonb, $3, false, $4) AS value",
    [replayContact.contact_id, '4000', replayPreview.preview_fingerprint, 'migration-replay-key-001']);
  let replayWait;
  try {
    replayWait = await waitForLock(admin, replayContenderPid, 'production migration idempotency serialization');
  } catch (error) {
    await a.query('ROLLBACK');
    await replayContender.catch(() => {});
    throw error;
  }
  assert.match(replayWait.query, /api\.receive_cash/i);
  await a.query('COMMIT');
  const replayed = await replayContender;
  assert.deepEqual(replayed, replayOriginal, 'concurrent same-key request must return the stored response');
  const replayCheck = await admin.query(
    `SELECT
       (SELECT count(*)::int FROM fortuna_private.financial_events WHERE contact_id = $1 AND event_type = 'cash_received') AS cash_events,
       (SELECT count(*)::int FROM fortuna_private.financial_idempotency WHERE book_id = (SELECT book_id FROM fortuna_private.financial_contacts WHERE id = $1) AND actor_user_id = $2 AND idempotency_key = $3) AS idempotency_rows,
       (SELECT COALESCE(sum(signed_minor), 0)::bigint FROM fortuna_private.financial_ledger_entries WHERE obligation_id = $4) AS remaining`,
    [replayContact.contact_id, ownerA, 'migration-replay-key-001', replayObligation.obligation_id],
  );
  assert.equal(replayCheck.rows[0].cash_events, 1);
  assert.equal(replayCheck.rows[0].idempotency_rows, 1);
  assert.equal(BigInt(replayCheck.rows[0].remaining), 6000n);
  console.log('PASS — production migration concurrent same-key retry returns one response with no duplicate event or ledger entry');


  await admin.query('REVOKE USAGE ON SCHEMA api FROM authenticated');
  await admin.query('REVOKE USAGE ON SCHEMA fortuna_private FROM authenticated');
  const grants = await admin.query(`
    SELECT
      has_table_privilege('authenticated', 'fortuna_private.financial_contacts', 'SELECT') AS authenticated_select,
      has_table_privilege('anon', 'fortuna_private.financial_contacts', 'SELECT') AS anon_select,
      has_schema_privilege('authenticated', 'api', 'USAGE') AS authenticated_api_schema,
      has_schema_privilege('authenticated', 'fortuna_private', 'USAGE') AS authenticated_private_schema,
      has_function_privilege('authenticated', 'api.list_obligations(uuid,text,text)', 'EXECUTE') AS authenticated_rpc,
      has_function_privilege('anon', 'api.list_obligations(uuid,text,text)', 'EXECUTE') AS anon_rpc
  `);
  assert.equal(grants.rows[0].authenticated_select, false);
  assert.equal(grants.rows[0].anon_select, false);
  assert.equal(grants.rows[0].authenticated_api_schema, false);
  assert.equal(grants.rows[0].authenticated_private_schema, false);
  assert.equal(grants.rows[0].authenticated_rpc, true);
  assert.equal(grants.rows[0].anon_rpc, false);
  console.log('PASS — authenticated API execution grants stay dormant without schema USAGE; anon and direct table access remain denied');
  console.log('PASS — complete production migration integration suite');
} finally {
  for (const client of clients) { try { await client.end(); } catch {} }
  if (postgresStarted && postgres) {
    if (process.platform === 'win32') await stopPostgres();
    else await postgres.stop();
  }
  await removeWithRetry(databaseDir);
}
