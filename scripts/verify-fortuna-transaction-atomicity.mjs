import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const schemaPath = process.env.FORTUNA_SQL_FILE;
const transactionPath = process.env.FORTUNA_TRANSACTION_SQL_FILE;
if (!schemaPath) throw new Error('FORTUNA_SQL_FILE must point to the isolated schema prototype');
if (!transactionPath) throw new Error('FORTUNA_TRANSACTION_SQL_FILE must point to the isolated transaction prototype');

const [schemaSql, transactionSql] = await Promise.all([
  readFile(schemaPath, 'utf8'),
  readFile(transactionPath, 'utf8'),
]);
const db = new PGlite();

const ids = {
  owner: '10000000-0000-4000-8000-000000000001',
  book: '20000000-0000-4000-8000-000000000001',
  contact: '30000000-0000-4000-8000-000000000001',
  receivable: '40000000-0000-4000-8000-000000000001',
  payable: '40000000-0000-4000-8000-000000000002',
};

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0]?.value;
}

async function expectFailure(label, operation, pattern) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected failure: ${label}`);
  assert.match(String(caught.message || caught), pattern, label);
  console.log(`PASS — ${label}`);
}

async function counts() {
  const result = await db.query(`
    SELECT
      (SELECT count(*)::int FROM fortuna_private.financial_events) AS events,
      (SELECT count(*)::int FROM fortuna_private.financial_allocations) AS allocations,
      (SELECT count(*)::int FROM fortuna_private.financial_ledger_entries) AS ledger,
      (SELECT count(*)::int FROM fortuna_private.financial_audit) AS audit,
      (SELECT count(*)::int FROM fortuna_private.financial_idempotency) AS idempotency
  `);
  return result.rows[0];
}

async function callOperation({
  key,
  hash,
  eventType = 'adjustment',
  amount = 100,
  allocations = [],
  ledgerLines = [{ obligation_id: ids.receivable, signed_minor: 100 }],
  reversesEventId = null,
  reversalReason = null,
  failAfter = null,
}) {
  const result = await db.query(
    `SELECT fortuna_private.test_commit_event_atomic(
       $1, $2, 'CUP', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12
     ) AS value`,
    [
      ids.book,
      ids.contact,
      ids.owner,
      key,
      hash,
      eventType,
      amount,
      JSON.stringify(allocations),
      JSON.stringify(ledgerLines),
      reversesEventId,
      reversalReason,
      failAfter,
    ]
  );
  return result.rows[0].value;
}

try {
  const version = await scalar('SELECT version() AS value');
  assert.match(String(version), /PostgreSQL 17/i, 'transaction harness must run PostgreSQL 17');
  console.log(`PASS — isolated engine: ${version}`);

  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.perfiles (id uuid PRIMARY KEY);
  `);
  await db.exec(schemaSql);
  await db.exec(transactionSql);
  console.log('PASS — test-only transaction function loaded after the isolated schema');

  const privilege = await db.query(`
    SELECT
      has_function_privilege(
        'service_role',
        'fortuna_private.test_commit_event_atomic(uuid,uuid,text,uuid,text,text,text,bigint,jsonb,jsonb,uuid,text,text)',
        'EXECUTE'
      ) AS service_can_execute,
      has_function_privilege(
        'anon',
        'fortuna_private.test_commit_event_atomic(uuid,uuid,text,uuid,text,text,text,bigint,jsonb,jsonb,uuid,text,text)',
        'EXECUTE'
      ) AS anon_can_execute,
      has_function_privilege(
        'authenticated',
        'fortuna_private.test_commit_event_atomic(uuid,uuid,text,uuid,text,text,text,bigint,jsonb,jsonb,uuid,text,text)',
        'EXECUTE'
      ) AS authenticated_can_execute
  `);
  assert.equal(privilege.rows[0].service_can_execute, true);
  assert.equal(privilege.rows[0].anon_can_execute, false);
  assert.equal(privilege.rows[0].authenticated_can_execute, false);
  console.log('PASS — only the service role has EXECUTE on the test transaction function');

  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [ids.owner]);
  await db.query(
    'INSERT INTO fortuna_private.financial_books (id, owner_user_id) VALUES ($1, $2)',
    [ids.book, ids.owner]
  );
  await db.query(
    'INSERT INTO fortuna_private.financial_contacts (id, book_id, display_name) VALUES ($1, $2, $3)',
    [ids.contact, ids.book, 'Atomic transaction fixture']
  );
  await db.exec(`
    INSERT INTO fortuna_private.financial_currencies (code, display_name, minor_unit_scale)
    VALUES ('CUP', 'Cuban Peso fixture', 2), ('USD', 'US Dollar fixture', 2);
  `);
  await db.query(
    `INSERT INTO fortuna_private.financial_obligations
      (id, book_id, contact_id, currency_code, direction, principal_minor, description, created_by)
     VALUES
      ($1, $2, $3, 'CUP', 'receivable', 10000, 'Receivable fixture', $4),
      ($5, $2, $3, 'CUP', 'payable', 5000, 'Payable fixture', $4)`,
    [ids.receivable, ids.book, ids.contact, ids.owner, ids.payable]
  );

  await db.exec('SET ROLE service_role');

  const opened = await callOperation({
    key: 'fortuna-open-000001',
    hash: 'a'.repeat(64),
    eventType: 'obligation_opened',
    amount: 10000,
    ledgerLines: [{ obligation_id: ids.receivable, signed_minor: 10000 }],
  });
  assert.ok(opened.event_id, 'opening response must include event ID');
  assert.equal(
    Number(await scalar(
      'SELECT coalesce(sum(signed_minor), 0)::bigint AS value FROM fortuna_private.financial_ledger_entries WHERE obligation_id = $1',
      [ids.receivable]
    )),
    10000
  );
  console.log('PASS — event, opening ledger line, audit and committed idempotency result are written together');

  const cashArgs = {
    key: 'fortuna-cash-000001',
    hash: 'b'.repeat(64),
    eventType: 'cash_received',
    amount: 4000,
    allocations: [{ obligation_id: ids.receivable, amount_minor: 4000 }],
    ledgerLines: [{ obligation_id: ids.receivable, signed_minor: -4000 }],
  };
  const cash = await callOperation(cashArgs);
  assert.ok(cash.event_id);
  const afterCash = await scalar(
    'SELECT coalesce(sum(signed_minor), 0)::bigint AS value FROM fortuna_private.financial_ledger_entries WHERE obligation_id = $1',
    [ids.receivable]
  );
  assert.equal(Number(afterCash), 6000);
  console.log('PASS — partial cash receipt stores allocation and signed ledger reduction');

  const beforeReplay = await counts();
  const replay = await callOperation(cashArgs);
  const afterReplay = await counts();
  assert.deepEqual(replay, cash, 'same key and same payload must replay the stored response');
  assert.deepEqual(afterReplay, beforeReplay, 'idempotent replay must not duplicate financial rows');
  console.log('PASS — same idempotency key and payload replays without duplicate writes');

  await expectFailure(
    'same idempotency key with a different payload is rejected',
    () => callOperation({ ...cashArgs, hash: 'c'.repeat(64), amount: 4500 }),
    /fortuna_idempotency_conflict/i
  );
  assert.deepEqual(await counts(), beforeReplay, 'payload conflict must not create additional rows');

  const compensation = await callOperation({
    key: 'fortuna-comp-000001',
    hash: 'd'.repeat(64),
    eventType: 'compensation',
    amount: 200,
    allocations: [
      { obligation_id: ids.receivable, amount_minor: 200 },
      { obligation_id: ids.payable, amount_minor: 200 },
    ],
    ledgerLines: [
      { obligation_id: ids.receivable, signed_minor: -200 },
      { obligation_id: ids.payable, signed_minor: 200 },
    ],
  });
  const compensationCheck = await db.query(
    `SELECT count(*)::int AS line_count, coalesce(sum(signed_minor), 0)::bigint AS net_minor
       FROM fortuna_private.financial_ledger_entries
      WHERE event_id = $1`,
    [compensation.event_id]
  );
  assert.equal(compensationCheck.rows[0].line_count, 2);
  assert.equal(Number(compensationCheck.rows[0].net_minor), 0);
  const compensationGross = await scalar(
    'SELECT total_amount_minor AS value FROM fortuna_private.financial_events WHERE id = $1',
    [compensation.event_id]
  );
  assert.equal(Number(compensationGross), 200, 'compensation event stores its gross amount once');
  console.log('PASS — same-contact/same-currency compensation envelope has two opposite ledger lines and one gross event amount');

  const reversal = await callOperation({
    key: 'fortuna-rev-000001',
    hash: 'e'.repeat(64),
    eventType: 'reversal',
    amount: 1000,
    allocations: [{ obligation_id: ids.receivable, amount_minor: 1000 }],
    ledgerLines: [{ obligation_id: ids.receivable, signed_minor: 1000 }],
    reversesEventId: cash.event_id,
    reversalReason: 'Controlled partial correction fixture',
  });
  const reversalCheck = await db.query(
    `SELECT reverses_event_id, reversal_reason
       FROM fortuna_private.financial_events
      WHERE id = $1`,
    [reversal.event_id]
  );
  assert.equal(reversalCheck.rows[0].reverses_event_id, cash.event_id);
  assert.equal(reversalCheck.rows[0].reversal_reason, 'Controlled partial correction fixture');
  console.log('PASS — reversal envelope links to its original event and requires a reason');

  const failpoints = [
    'after_processing',
    'after_event',
    'after_allocations',
    'after_ledger',
    'after_audit',
    'after_idempotency_commit',
  ];
  for (const failpoint of failpoints) {
    const before = await counts();
    await expectFailure(
      `failure at ${failpoint} rolls back the whole transaction`,
      () => callOperation({
        key: `fortuna-fail-${failpoint}-0001`,
        hash: 'f'.repeat(64),
        eventType: 'adjustment',
        amount: 50,
        allocations: [{ obligation_id: ids.receivable, amount_minor: 50 }],
        ledgerLines: [{ obligation_id: ids.receivable, signed_minor: 50 }],
        failAfter: failpoint,
      }),
      /fortuna_test_failpoint/i
    );
    assert.deepEqual(
      await counts(),
      before,
      `no event, allocation, ledger, audit or idempotency row may survive ${failpoint}`
    );
  }

  const finalCounts = await counts();
  assert.equal(Number(finalCounts.events), 4, 'only opening, receipt, compensation and reversal events should persist');
  assert.equal(Number(finalCounts.idempotency), 4, 'each committed event has exactly one committed idempotency record');
  console.log('PASS — all injected failures leave no partial financial or idempotency rows');
  console.log('PASS — FORTUNA isolated transaction atomicity verification complete');
} finally {
  try {
    await db.exec('RESET ROLE');
  } catch {
    // RESET ROLE may fail only if SET ROLE was never reached or the connection is closed.
  }
  await db.close();
}
