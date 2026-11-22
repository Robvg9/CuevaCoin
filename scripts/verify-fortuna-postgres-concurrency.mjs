import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

const schemaPath = process.env.FORTUNA_SCHEMA_SQL_FILE;
const settlementPath = process.env.FORTUNA_SETTLEMENT_SQL_FILE;
const operationsPath = process.env.FORTUNA_OPERATIONS_SQL_FILE;
const settlementApiPath = process.env.FORTUNA_SETTLEMENT_API_SQL_FILE;
if (!schemaPath) throw new Error('FORTUNA_SCHEMA_SQL_FILE is required');
if (!settlementPath) throw new Error('FORTUNA_SETTLEMENT_SQL_FILE is required');
if (!operationsPath) throw new Error('FORTUNA_OPERATIONS_SQL_FILE is required');
if (!settlementApiPath) throw new Error('FORTUNA_SETTLEMENT_API_SQL_FILE is required');

const [schemaSql, settlementSql, operationsSql, settlementApiSql] = await Promise.all([
  readFile(schemaPath, 'utf8'),
  readFile(settlementPath, 'utf8'),
  readFile(operationsPath, 'utf8'),
  readFile(settlementApiPath, 'utf8'),
]);

const ids = {
  owner: '10000000-0000-4000-8000-000000000001',
  book: '20000000-0000-4000-8000-000000000001',
  contact: '30000000-0000-4000-8000-000000000001',
  receivable1: '40000000-0000-4000-8000-000000000001',
  receivable2: '40000000-0000-4000-8000-000000000002',
  openingEvent1: '50000000-0000-4000-8000-000000000001',
  openingEvent2: '50000000-0000-4000-8000-000000000002',
};

const databaseDir = await mkdtemp(path.join(tmpdir(), 'fortuna-v1-pg17-'));
const postgresPassword = 'fortuna-isolated-test-only';
const postgresErrors = [];
let postgres;
let postgresStarted = false;
let admin;
const clients = [];

async function removeDirectoryWithRetry(directory, { attempts = 20, delayMs = 250 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY', 'EMFILE', 'ENFILE'].includes(error?.code)) {
        throw error;
      }
      if (attempt < attempts) await delay(delayMs);
    }
  }
  throw lastError;
}

async function findFreePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

const port = await findFreePort();

function newClient(applicationName) {
  const client = new Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: postgresPassword,
    database: 'postgres',
    application_name: applicationName,
    connectionTimeoutMillis: 20000,
    query_timeout: 30000,
    ssl: false,
  });
  clients.push(client);
  return client;
}

async function connectClient(applicationName) {
  const client = newClient(applicationName);
  await client.connect();
  return client;
}

async function seedObligation({ id, eventId, direction, amount, openedAt }) {
  await admin.query(
    'INSERT INTO fortuna_private.financial_obligations (id, book_id, contact_id, currency_code, direction, principal_minor, description, created_by, opened_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [id, ids.book, ids.contact, 'CUP', direction, amount, 'Native PostgreSQL concurrency fixture', ids.owner, openedAt]
  );
  await admin.query(
    'INSERT INTO fortuna_private.financial_events (id, book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [eventId, ids.book, ids.contact, 'CUP', 'obligation_opened', amount, ids.owner]
  );
  await admin.query(
    'INSERT INTO fortuna_private.financial_ledger_entries (book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [ids.book, eventId, ids.contact, 'CUP', id, 'obligation_opened', direction === 'receivable' ? amount : -amount]
  );
}

async function activateServiceRole(client) {
  await client.query('SET ROLE service_role');
}

async function settle(client, args) {
  const result = await client.query(
    'SELECT fortuna_private.test_commit_settlement_atomic($1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::text, $7::text, $8::text, $9::bigint, $10::jsonb, $11::boolean, $12::text) AS value',
    [
      ids.book,
      ids.contact,
      'CUP',
      ids.owner,
      args.key,
      args.hash,
      'cash_received',
      'fifo',
      String(args.amountMinor),
      JSON.stringify([]),
      args.confirmOverage,
      null,
    ]
  );
  const value = result.rows[0].value;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function asJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function authenticate(client, userId) {
  await client.query('RESET ROLE');
  await client.query('SET ROLE authenticated');
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function apiCreateContact(client, name, key) {
  const result = await client.query(
    'SELECT api.create_contact($1, NULL, NULL, $2) AS value',
    [name, key]
  );
  return asJson(result.rows[0].value);
}

async function apiOpenObligation(client, contactId, amountMinor, key) {
  const result = await client.query(
    "SELECT api.open_obligation($1, 'receivable', 'CUP', $2, 'Native API concurrency fixture', NULL, $3) AS value",
    [contactId, String(amountMinor), key]
  );
  return asJson(result.rows[0].value);
}

async function apiPreview(client, contactId, amountMinor) {
  const result = await client.query(
    "SELECT api.preview_settlement($1, 'CUP', 'cash_received', 'fifo', $2, '[]'::jsonb) AS value",
    [contactId, String(amountMinor)]
  );
  return asJson(result.rows[0].value);
}

async function apiReceive(client, contactId, amountMinor, fingerprint, key) {
  const result = await client.query(
    "SELECT api.receive_cash($1, 'CUP', 'fifo', $2, '[]'::jsonb, $3, false, $4) AS value",
    [contactId, String(amountMinor), fingerprint, key]
  );
  return asJson(result.rows[0].value);
}

async function waitForLock(observer, pid, scenario) {
  const deadline = Date.now() + 15000;
  let lastActivity = null;
  while (Date.now() < deadline) {
    const result = await observer.query(
      'SELECT state, wait_event_type, wait_event, query FROM pg_stat_activity WHERE pid = $1',
      [pid]
    );
    lastActivity = result.rows[0] || null;
    if (lastActivity && lastActivity.wait_event_type === 'Lock') {
      assert.equal(lastActivity.state, 'active', scenario + ': blocked backend must remain active');
      return lastActivity;
    }
    if (!lastActivity || lastActivity.state === 'idle') {
      throw new Error(scenario + ': contender returned or disconnected before observing a database lock');
    }
    await delay(25);
  }
  throw new Error(
    scenario + ': expected a real PostgreSQL lock wait; last activity=' + JSON.stringify(lastActivity)
  );
}

async function counts() {
  const result = await admin.query(
    'SELECT (SELECT count(*)::int FROM fortuna_private.financial_obligations) AS obligations, (SELECT count(*)::int FROM fortuna_private.financial_events) AS events, (SELECT count(*)::int FROM fortuna_private.financial_allocations) AS allocations, (SELECT count(*)::int FROM fortuna_private.financial_ledger_entries) AS ledger, (SELECT count(*)::int FROM fortuna_private.financial_audit) AS audit, (SELECT count(*)::int FROM fortuna_private.financial_idempotency) AS idempotency'
  );
  return result.rows[0];
}

async function balance(obligationId) {
  const result = await admin.query(
    'SELECT COALESCE(sum(signed_minor), 0)::bigint AS value FROM fortuna_private.financial_ledger_entries WHERE obligation_id = $1',
    [obligationId]
  );
  return BigInt(result.rows[0].value);
}

async function expectFailure(operation, pattern, label) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, label + ': expected operation to fail');
  assert.match(String(caught.message || caught), pattern, label);
  console.log('PASS — ' + label);
}

try {
  postgres = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: postgresPassword,
    port,
    // Keep directory ownership in this script. On Windows, the library's
    // persistent:false cleanup can race process-tree shutdown and hit EBUSY.
    persistent: true,
    autoRehydrateSymlinks: true,
    onLog: () => {},
    onError: error => postgresErrors.push(String(error)),
  });

  await postgres.initialise();
  await postgres.start();
  postgresStarted = true;

  admin = await connectClient('fortuna-pg17-admin');
  const versionResult = await admin.query('SELECT version() AS version');
  const version = versionResult.rows[0].version;
  assert.match(version, /PostgreSQL 17\.11(?:\.|\s)/i, 'native test server must be PostgreSQL 17.11');
  console.log('PASS — native PostgreSQL engine: ' + version);

  await admin.query(
    'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY); CREATE TABLE public.perfiles (id uuid PRIMARY KEY)'
  );
  await admin.query(schemaSql);
  await admin.query(operationsSql);
  await admin.query(settlementApiSql);
  await admin.query(settlementSql);
  console.log('PASS — FORTUNA schema, owner API, settlement API and native concurrency helper loaded');

  await admin.query('INSERT INTO auth.users (id) VALUES ($1)', [ids.owner]);
  await admin.query(
    'INSERT INTO fortuna_private.financial_books (id, owner_user_id) VALUES ($1, $2)',
    [ids.book, ids.owner]
  );
  await admin.query(
    'INSERT INTO fortuna_private.financial_contacts (id, book_id, display_name) VALUES ($1, $2, $3)',
    [ids.contact, ids.book, 'Native PostgreSQL concurrency contact']
  );
  await admin.query(
    'INSERT INTO fortuna_private.financial_currencies (code, display_name, minor_unit_scale) VALUES ($1, $2, $3)',
    ['CUP', 'Cuban Peso', 2]
  );
  await seedObligation({
    id: ids.receivable1,
    eventId: ids.openingEvent1,
    direction: 'receivable',
    amount: 1000,
    openedAt: '2026-01-01T00:00:00Z',
  });

  const clientA = await connectClient('fortuna-concurrent-settlement-a');
  const clientB = await connectClient('fortuna-concurrent-settlement-b');
  const observer = await connectClient('fortuna-lock-observer');
  await activateServiceRole(clientA);
  await activateServiceRole(clientB);

  // Settlement race: A writes 700 but deliberately holds its outer transaction open.
  // B starts an independent backend session and must wait on A's row lock.
  await clientA.query('BEGIN');
  const firstSettlement = await settle(clientA, {
    key: 'fortuna-concurrent-settle-a',
    hash: 'a'.repeat(64),
    amountMinor: 700,
    confirmOverage: false,
  });
  assert.equal(Number(firstSettlement.allocated_minor), 700);
  assert.equal(Number(firstSettlement.overage_minor), 0);

  const contenderPidResult = await clientB.query('SELECT pg_backend_pid() AS pid');
  const contenderPid = contenderPidResult.rows[0].pid;
  const secondSettlementPromise = settle(clientB, {
    key: 'fortuna-concurrent-settle-b',
    hash: 'b'.repeat(64),
    amountMinor: 700,
    confirmOverage: true,
  });

  let settlementWait;
  try {
    settlementWait = await waitForLock(observer, contenderPid, 'concurrent settlement');
  } catch (error) {
    await clientA.query('ROLLBACK');
    await secondSettlementPromise.catch(() => {});
    throw error;
  }
  assert.match(settlementWait.query, /test_commit_settlement_atomic/i);
  console.log('PASS — second settlement is blocked by PostgreSQL row locking on a separate backend');

  await clientA.query('COMMIT');
  const secondSettlement = await secondSettlementPromise;
  assert.equal(Number(secondSettlement.allocated_minor), 300, 'second settlement must see only the true remaining 300');
  assert.equal(Number(secondSettlement.overage_minor), 400, 'confirmed excess must be computed after the first transaction commits');
  assert.ok(secondSettlement.overage_obligation_id);

  const firstBalance = await balance(ids.receivable1);
  assert.equal(firstBalance, 0n, 'concurrent settlements must never over-apply the receivable');
  const overageResult = await admin.query(
    'SELECT direction, principal_minor FROM fortuna_private.financial_obligations WHERE id = $1',
    [secondSettlement.overage_obligation_id]
  );
  assert.equal(overageResult.rows[0].direction, 'payable');
  assert.equal(Number(overageResult.rows[0].principal_minor), 400);
  assert.equal(await balance(secondSettlement.overage_obligation_id), -400n);

  const concurrentEventAmounts = await admin.query(
    'SELECT e.id, e.total_amount_minor, COALESCE(sum(l.signed_minor), 0)::bigint AS ledger_total FROM fortuna_private.financial_events e JOIN fortuna_private.financial_ledger_entries l ON l.book_id = e.book_id AND l.event_id = e.id WHERE e.id IN ($1, $2) GROUP BY e.id, e.total_amount_minor',
    [firstSettlement.event_id, secondSettlement.event_id]
  );
  assert.equal(concurrentEventAmounts.rows.length, 2);
  assert.ok(concurrentEventAmounts.rows.every(row => Number(row.total_amount_minor) === 700));
  assert.ok(concurrentEventAmounts.rows.every(row => BigInt(row.ledger_total) === -700n));

  const raceCounts = await counts();
  assert.equal(Number(raceCounts.events), 3, 'one opening and exactly two cash events');
  assert.equal(Number(raceCounts.allocations), 2, 'each cash event has one bounded allocation');
  assert.equal(Number(raceCounts.idempotency), 2, 'each committed cash event has one idempotency record');
  console.log('PASS — competing settlements serialize, allocate 700 + 300, and create only the confirmed 400 payable excess');

  // Idempotency race: two independent sessions submit the same key and payload.
  // The second insert waits on PostgreSQL's unique-index conflict until A commits.
  await seedObligation({
    id: ids.receivable2,
    eventId: ids.openingEvent2,
    direction: 'receivable',
    amount: 500,
    openedAt: '2026-02-01T00:00:00Z',
  });

  await clientA.query('BEGIN');
  const idempotentArgs = {
    key: 'fortuna-concurrent-idempotency',
    hash: 'c'.repeat(64),
    amountMinor: 200,
    confirmOverage: false,
  };
  const originalResponse = await settle(clientA, idempotentArgs);
  const duplicatePidResult = await clientB.query('SELECT pg_backend_pid() AS pid');
  const duplicatePid = duplicatePidResult.rows[0].pid;
  const duplicatePromise = settle(clientB, idempotentArgs);

  let idempotencyWait;
  try {
    idempotencyWait = await waitForLock(observer, duplicatePid, 'concurrent idempotency replay');
  } catch (error) {
    await clientA.query('ROLLBACK');
    await duplicatePromise.catch(() => {});
    throw error;
  }
  assert.match(idempotencyWait.query, /test_commit_settlement_atomic/i);
  console.log('PASS — duplicate request waits on PostgreSQL unique idempotency key');

  await clientA.query('COMMIT');
  const replayResponse = await duplicatePromise;
  assert.deepEqual(replayResponse, originalResponse, 'concurrent replay must return the original response');
  assert.equal(await balance(ids.receivable2), 300n);

  const afterConcurrentReplay = await counts();
  assert.equal(Number(afterConcurrentReplay.events), Number(raceCounts.events) + 2, 'one seed opening plus one committed settlement, no duplicate cash event');
  assert.equal(Number(afterConcurrentReplay.allocations), Number(raceCounts.allocations) + 1);
  assert.equal(Number(afterConcurrentReplay.ledger), Number(raceCounts.ledger) + 2, 'one opening line and one settlement line only');
  assert.equal(Number(afterConcurrentReplay.audit), Number(raceCounts.audit) + 1);
  assert.equal(Number(afterConcurrentReplay.idempotency), Number(raceCounts.idempotency) + 1);
  console.log('PASS — concurrent same-key/same-payload retry returns the original response without duplicate rows');

  await expectFailure(
    () => settle(clientB, { ...idempotentArgs, hash: 'd'.repeat(64), amountMinor: 250 }),
    /fortuna_idempotency_conflict/i,
    'same idempotency key with a different payload remains a conflict'
  );
  const afterConflict = await counts();
  assert.deepEqual(afterConflict, afterConcurrentReplay, 'payload conflict must not create financial rows');

  // Exercise the new owner-scoped preview/confirm RPC path on independent
  // native PostgreSQL sessions. JWT subject is simulated at the SQL claim layer;
  // this verifies database locking/idempotency, not Supabase JWT signature checks.
  await authenticate(clientA, ids.owner);
  await authenticate(clientB, ids.owner);

  const apiContact = await apiCreateContact(
    clientA,
    'Native owner-settlement API replay contact',
    'native-api-contact-replay-001'
  );
  await apiOpenObligation(clientA, apiContact.contact_id, 1000, 'native-api-open-replay-0001');
  const apiPreviewReplay = await apiPreview(clientA, apiContact.contact_id, 700);
  const apiReplayArgs = {
    contactId: apiContact.contact_id,
    amountMinor: 700,
    fingerprint: apiPreviewReplay.preview_fingerprint,
    key: 'native-api-same-key-replay-001',
  };

  await clientA.query('BEGIN');
  const apiOriginal = await apiReceive(
    clientA, apiReplayArgs.contactId, apiReplayArgs.amountMinor,
    apiReplayArgs.fingerprint, apiReplayArgs.key
  );
  const apiDuplicatePid = (await clientB.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const apiDuplicatePromise = apiReceive(
    clientB, apiReplayArgs.contactId, apiReplayArgs.amountMinor,
    apiReplayArgs.fingerprint, apiReplayArgs.key
  );

  let apiReplayWait;
  try {
    apiReplayWait = await waitForLock(observer, apiDuplicatePid, 'owner API same-key replay');
  } catch (error) {
    await clientA.query('ROLLBACK');
    await apiDuplicatePromise.catch(() => {});
    throw error;
  }
  assert.match(apiReplayWait.query, /api\.receive_cash/i);
  await clientA.query('COMMIT');
  const apiReplay = await apiDuplicatePromise;
  assert.deepEqual(apiReplay, apiOriginal, 'same-key owner API retry must return original response');
  console.log('PASS — owner API same-key concurrent retry waits on contact lock and replays one original event');

  const staleContact = await apiCreateContact(
    clientA,
    'Native owner-settlement stale preview contact',
    'native-api-contact-stale-001'
  );
  const staleObligation = await apiOpenObligation(
    clientA, staleContact.contact_id, 1000, 'native-api-open-stale-0001'
  );
  const stalePreview = await apiPreview(clientA, staleContact.contact_id, 800);
  const staleAKey = 'native-api-stale-confirm-a01';
  const staleBKey = 'native-api-stale-confirm-b01';

  await clientA.query('BEGIN');
  const committedFirst = await apiReceive(
    clientA, staleContact.contact_id, 800, stalePreview.preview_fingerprint, staleAKey
  );
  const staleContenderPid = (await clientB.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const staleContenderPromise = apiReceive(
    clientB, staleContact.contact_id, 800, stalePreview.preview_fingerprint, staleBKey
  );

  let staleWait;
  try {
    staleWait = await waitForLock(observer, staleContenderPid, 'owner API stale preview serialization');
  } catch (error) {
    await clientA.query('ROLLBACK');
    await staleContenderPromise.catch(() => {});
    throw error;
  }
  assert.match(staleWait.query, /api\.receive_cash/i);
  await clientA.query('COMMIT');
  await expectFailure(
    () => staleContenderPromise,
    /fortuna_stale_preview/i,
    'second owner API confirmation based on an old preview is rejected after the first commits'
  );

  const staleBalance = await balance(staleObligation.obligation_id);
  assert.equal(staleBalance, 200n);
  const staleEventCount = await admin.query(
    'SELECT count(*)::int AS count FROM fortuna_private.financial_events WHERE id = $1',
    [committedFirst.event_id]
  );
  assert.equal(staleEventCount.rows[0].count, 1);
  const staleIdempotencyCount = await admin.query(
    'SELECT count(*)::int AS count FROM fortuna_private.financial_idempotency WHERE idempotency_key IN ($1, $2)',
    [staleAKey, staleBKey]
  );
  assert.equal(staleIdempotencyCount.rows[0].count, 1, 'stale contender must roll back its idempotency reservation');
  console.log('PASS — native concurrent owner API requests serialize and stale preview creates no second event or idempotency row');
  
  await admin.query('SELECT 1');
  console.log('PASS — all native PostgreSQL 17.11 concurrency and idempotency invariants verified');
} catch (error) {
  if (postgresErrors.length) {
    console.error('PostgreSQL process diagnostics:', postgresErrors.join('\n'));
  }
  throw error;
} finally {
  for (const client of clients) {
    try {
      await client.end();
    } catch {}
  }
  if (postgresStarted && postgres) {
    try {
      await postgres.stop();
    } catch (error) {
      console.error('PostgreSQL shutdown warning:', String(error));
    }
  }
  await removeDirectoryWithRetry(databaseDir);
}
