import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const schemaPath = process.env.FORTUNA_SQL_FILE;
const settlementPath = process.env.FORTUNA_SETTLEMENT_SQL_FILE;
if (!schemaPath) throw new Error('FORTUNA_SQL_FILE must point to the isolated schema prototype');
if (!settlementPath) throw new Error('FORTUNA_SETTLEMENT_SQL_FILE must point to the isolated settlement prototype');

const [schemaSql, settlementSql] = await Promise.all([
  readFile(schemaPath, 'utf8'),
  readFile(settlementPath, 'utf8'),
]);
const db = new PGlite();

const ids = {
  owner: '10000000-0000-4000-8000-000000000001',
  book: '20000000-0000-4000-8000-000000000001',
  contact: '30000000-0000-4000-8000-000000000001',
  r1: '40000000-0000-4000-8000-000000000001',
  r2: '40000000-0000-4000-8000-000000000002',
  r3: '40000000-0000-4000-8000-000000000003',
  p1: '40000000-0000-4000-8000-000000000004',
  p2: '40000000-0000-4000-8000-000000000005',
};

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0]?.value;
}

async function balance(obligationId) {
  const value = await scalar(
    'SELECT COALESCE(sum(signed_minor), 0)::bigint AS value FROM fortuna_private.financial_ledger_entries WHERE obligation_id = $1',
    [obligationId]
  );
  return BigInt(value ?? 0);
}

async function counts() {
  const result = await db.query(`
    SELECT
      (SELECT count(*)::int FROM fortuna_private.financial_obligations) AS obligations,
      (SELECT count(*)::int FROM fortuna_private.financial_events) AS events,
      (SELECT count(*)::int FROM fortuna_private.financial_allocations) AS allocations,
      (SELECT count(*)::int FROM fortuna_private.financial_ledger_entries) AS ledger,
      (SELECT count(*)::int FROM fortuna_private.financial_audit) AS audit,
      (SELECT count(*)::int FROM fortuna_private.financial_idempotency) AS idempotency
  `);
  return result.rows[0];
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

async function commitSettlement({
  key,
  hash,
  flow,
  mode,
  totalMinor,
  requestedAllocations = [],
  confirmOverage = false,
  failAfter = null,
  currency = 'CUP',
}) {
  const result = await db.query(
    `SELECT fortuna_private.test_commit_settlement_atomic(
      $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::text,
      $7::text, $8::text, $9::bigint, $10::jsonb, $11::boolean, $12::text
    ) AS value`,
    [
      ids.book,
      ids.contact,
      currency,
      ids.owner,
      key,
      hash,
      flow,
      mode,
      String(totalMinor),
      JSON.stringify(requestedAllocations),
      confirmOverage,
      failAfter,
    ]
  );
  const value = result.rows[0].value;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function seedObligation({ id, direction, amount, openedAt, eventId }) {
  await db.query(
    `INSERT INTO fortuna_private.financial_obligations
      (id, book_id, contact_id, currency_code, direction, principal_minor, description, created_by, opened_at)
     VALUES ($1, $2, $3, 'CUP', $4, $5, $6, $7, $8)`,
    [id, ids.book, ids.contact, direction, amount, `Opening ${direction} fixture`, ids.owner, openedAt]
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_events
      (id, book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id)
     VALUES ($1, $2, $3, 'CUP', 'obligation_opened', $4, $5)`,
    [eventId, ids.book, ids.contact, amount, ids.owner]
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_ledger_entries
      (book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor)
     VALUES ($1, $2, $3, 'CUP', $4, 'obligation_opened', $5)`,
    [ids.book, eventId, ids.contact, id, direction === 'receivable' ? amount : -amount]
  );
}

try {
  const version = await scalar('SELECT version() AS value');
  assert.match(String(version), /PostgreSQL 17/i, 'settlement harness must run PostgreSQL 17');
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
  await db.exec(settlementSql);
  console.log('PASS — isolated schema and settlement operation fixture load');

  const privilege = await db.query(`
    SELECT
      has_function_privilege(
        'service_role',
        'fortuna_private.test_commit_settlement_atomic(uuid,uuid,text,uuid,text,text,text,text,bigint,jsonb,boolean,text)',
        'EXECUTE'
      ) AS service_can_execute,
      has_function_privilege(
        'anon',
        'fortuna_private.test_commit_settlement_atomic(uuid,uuid,text,uuid,text,text,text,text,bigint,jsonb,boolean,text)',
        'EXECUTE'
      ) AS anon_can_execute,
      has_function_privilege(
        'authenticated',
        'fortuna_private.test_commit_settlement_atomic(uuid,uuid,text,uuid,text,text,text,text,bigint,jsonb,boolean,text)',
        'EXECUTE'
      ) AS authenticated_can_execute,
      has_table_privilege(
        'service_role',
        'fortuna_private.financial_obligations',
        'UPDATE'
      ) AS service_can_update_obligations,
      (
        SELECT prosecdef
          FROM pg_proc
         WHERE oid = 'fortuna_private.test_commit_settlement_atomic(uuid,uuid,text,uuid,text,text,text,text,bigint,jsonb,boolean,text)'::regprocedure
      ) AS function_is_security_definer
  `);
  assert.equal(privilege.rows[0].service_can_execute, true);
  assert.equal(privilege.rows[0].anon_can_execute, false);
  assert.equal(privilege.rows[0].authenticated_can_execute, false);
  assert.equal(privilege.rows[0].service_can_update_obligations, false);
  assert.equal(privilege.rows[0].function_is_security_definer, true);
  console.log('PASS — restricted SECURITY DEFINER helper can lock rows without granting direct UPDATE to service_role');

  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [ids.owner]);
  await db.query(
    'INSERT INTO fortuna_private.financial_books (id, owner_user_id) VALUES ($1, $2)',
    [ids.book, ids.owner]
  );
  await db.query(
    'INSERT INTO fortuna_private.financial_contacts (id, book_id, display_name) VALUES ($1, $2, $3)',
    [ids.contact, ids.book, 'Settlement operation fixture']
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_currencies (code, display_name, minor_unit_scale)
     VALUES ('CUP', 'Cuban Peso fixture', 2)`
  );

  // Two receivables share opened_at; UUID order is the stable FIFO tiebreaker.
  await seedObligation({
    id: ids.r1, direction: 'receivable', amount: 3000,
    openedAt: '2026-01-01T00:00:00Z', eventId: '50000000-0000-4000-8000-000000000001'
  });
  await seedObligation({
    id: ids.r2, direction: 'receivable', amount: 5000,
    openedAt: '2026-01-02T00:00:00Z', eventId: '50000000-0000-4000-8000-000000000002'
  });
  await seedObligation({
    id: ids.r3, direction: 'receivable', amount: 2000,
    openedAt: '2026-01-02T00:00:00Z', eventId: '50000000-0000-4000-8000-000000000003'
  });
  await seedObligation({
    id: ids.p1, direction: 'payable', amount: 4000,
    openedAt: '2026-01-03T00:00:00Z', eventId: '50000000-0000-4000-8000-000000000004'
  });
  await seedObligation({
    id: ids.p2, direction: 'payable', amount: 3000,
    openedAt: '2026-01-04T00:00:00Z', eventId: '50000000-0000-4000-8000-000000000005'
  });

  await db.exec('SET ROLE service_role');

  const fifoArgs = {
    key: 'settlement-fifo-0001',
    hash: 'a'.repeat(64),
    flow: 'cash_received',
    mode: 'fifo',
    totalMinor: 4000,
  };
  const fifo = await commitSettlement(fifoArgs);
  assert.deepEqual(
    fifo.allocations.map(item => [item.obligation_id, Number(item.amount_minor)]),
    [[ids.r1, 3000], [ids.r2, 1000]],
    'FIFO must use opened_at, then stable UUID order'
  );
  assert.equal(await balance(ids.r1), 0n);
  assert.equal(await balance(ids.r2), 4000n);
  assert.equal(await balance(ids.r3), 2000n);
  const fifoLedger = await scalar(
    'SELECT COALESCE(sum(signed_minor), 0)::bigint AS value FROM fortuna_private.financial_ledger_entries WHERE event_id = $1',
    [fifo.event_id]
  );
  assert.equal(BigInt(fifoLedger), -4000n);
  console.log('PASS — FIFO receives oldest first and uses UUID order for equal opened_at');

  const afterFifo = await counts();
  const fifoReplay = await commitSettlement(fifoArgs);
  assert.deepEqual(fifoReplay, fifo);
  assert.deepEqual(await counts(), afterFifo);
  await expectFailure(
    'same FIFO key cannot be reused with a different payload',
    () => commitSettlement({ ...fifoArgs, hash: 'b'.repeat(64), totalMinor: 3500 }),
    /fortuna_idempotency_conflict/i
  );
  assert.deepEqual(await counts(), afterFifo);

  const manualReceipt = await commitSettlement({
    key: 'settlement-manual-rec-01',
    hash: 'c'.repeat(64),
    flow: 'cash_received',
    mode: 'manual',
    totalMinor: 500,
    requestedAllocations: [{ obligation_id: ids.r3, amount_minor: 500 }],
  });
  assert.deepEqual(
    manualReceipt.allocations.map(item => [item.obligation_id, Number(item.amount_minor)]),
    [[ids.r3, 500]]
  );
  assert.equal(await balance(ids.r3), 1500n);
  console.log('PASS — manual receipt applies only to the selected same-contact, same-currency receivable');

  const manualPayment = await commitSettlement({
    key: 'settlement-manual-pay-01',
    hash: 'd'.repeat(64),
    flow: 'cash_paid',
    mode: 'manual',
    totalMinor: 2500,
    requestedAllocations: [
      { obligation_id: ids.p1, amount_minor: 1000 },
      { obligation_id: ids.p2, amount_minor: 1500 },
    ],
  });
  assert.deepEqual(
    manualPayment.allocations.map(item => [item.obligation_id, Number(item.amount_minor)]),
    [[ids.p1, 1000], [ids.p2, 1500]]
  );
  assert.equal(await balance(ids.p1), -3000n);
  assert.equal(await balance(ids.p2), -1500n);
  console.log('PASS — manual payment supports multiple bounded allocations to payable obligations');

  const beforeInvalid = await counts();
  await expectFailure(
    'cash payment cannot allocate against a receivable',
    () => commitSettlement({
      key: 'settlement-invalid-dir-01',
      hash: 'e'.repeat(64),
      flow: 'cash_paid',
      mode: 'manual',
      totalMinor: 100,
      requestedAllocations: [{ obligation_id: ids.r1, amount_minor: 100 }],
    }),
    /fortuna_settlement_manual_direction_mismatch/i
  );
  await expectFailure(
    'manual allocation cannot exceed the real remaining balance',
    () => commitSettlement({
      key: 'settlement-invalid-pending-01',
      hash: 'f'.repeat(64),
      flow: 'cash_paid',
      mode: 'manual',
      totalMinor: 2000,
      requestedAllocations: [{ obligation_id: ids.p2, amount_minor: 1600 }],
    }),
    /fortuna_settlement_manual_exceeds_real_pending_balance/i
  );
  await expectFailure(
    'manual allocation cannot repeat an obligation',
    () => commitSettlement({
      key: 'settlement-invalid-duplicate-01',
      hash: '1'.repeat(64),
      flow: 'cash_received',
      mode: 'manual',
      totalMinor: 200,
      requestedAllocations: [
        { obligation_id: ids.r3, amount_minor: 100 },
        { obligation_id: ids.r3, amount_minor: 100 },
      ],
    }),
    /fortuna_settlement_duplicate_manual_obligation/i
  );
  await expectFailure(
    'manual allocation cannot cross currency',
    () => commitSettlement({
      key: 'settlement-invalid-currency-01',
      hash: '2'.repeat(64),
      flow: 'cash_received',
      mode: 'manual',
      totalMinor: 100,
      requestedAllocations: [{ obligation_id: ids.r2, amount_minor: 100 }],
      currency: 'USD',
    }),
    /fortuna_settlement_manual_obligation_not_in_contact_currency_or_book/i
  );
  assert.deepEqual(await counts(), beforeInvalid, 'invalid manual requests must not create any rows');
  console.log('PASS — invalid manual direction, pending amount, duplicates and currency are rejected without writes');

  const receiveOverageArgs = {
    key: 'settlement-receive-overage-01',
    hash: '3'.repeat(64),
    flow: 'cash_received',
    mode: 'fifo',
    totalMinor: 6000,
  };
  const beforeReceiveOverage = await counts();
  await expectFailure(
    'cash received above open receivables requires explicit confirmation',
    () => commitSettlement(receiveOverageArgs),
    /fortuna_overage_confirmation_required/i
  );
  assert.deepEqual(await counts(), beforeReceiveOverage);
  const receiveOverage = await commitSettlement({ ...receiveOverageArgs, confirmOverage: true });
  assert.equal(Number(receiveOverage.allocated_minor), 5500);
  assert.equal(Number(receiveOverage.overage_minor), 500);
  assert.deepEqual(
    receiveOverage.allocations.map(item => [item.obligation_id, Number(item.amount_minor)]),
    [[ids.r2, 4000], [ids.r3, 1500]]
  );
  assert.ok(receiveOverage.overage_obligation_id);
  const receivedOverageObligation = await db.query(
    'SELECT direction, principal_minor FROM fortuna_private.financial_obligations WHERE id = $1',
    [receiveOverage.overage_obligation_id]
  );
  assert.equal(receivedOverageObligation.rows[0].direction, 'payable');
  assert.equal(Number(receivedOverageObligation.rows[0].principal_minor), 500);
  assert.equal(await balance(ids.r2), 0n);
  assert.equal(await balance(ids.r3), 0n);
  const receiveLedger = await scalar(
    'SELECT COALESCE(sum(signed_minor), 0)::bigint AS value FROM fortuna_private.financial_ledger_entries WHERE event_id = $1',
    [receiveOverage.event_id]
  );
  assert.equal(BigInt(receiveLedger), -6000n);
  console.log('PASS — confirmed received overage creates only the opposite payable and reconciles the full cash amount');

  const payOverageArgs = {
    key: 'settlement-pay-overage-01',
    hash: '4'.repeat(64),
    flow: 'cash_paid',
    mode: 'fifo',
    totalMinor: 6000,
  };
  const beforePayOverage = await counts();
  await expectFailure(
    'cash paid above open payables requires explicit confirmation',
    () => commitSettlement(payOverageArgs),
    /fortuna_overage_confirmation_required/i
  );
  assert.deepEqual(await counts(), beforePayOverage);
  await expectFailure(
    'settlement rollback after creating the overage obligation leaves no partial rows',
    () => commitSettlement({ ...payOverageArgs, confirmOverage: true, failAfter: 'after_overage_obligation' }),
    /fortuna_settlement_test_failpoint: after_overage_obligation/i
  );
  assert.deepEqual(await counts(), beforePayOverage);
  const payOverage = await commitSettlement({ ...payOverageArgs, confirmOverage: true });
  assert.equal(Number(payOverage.allocated_minor), 5000);
  assert.equal(Number(payOverage.overage_minor), 1000);
  assert.deepEqual(
    payOverage.allocations.map(item => [item.obligation_id, Number(item.amount_minor)]),
    [
      [ids.p1, 3000],
      [ids.p2, 1500],
      [receiveOverage.overage_obligation_id, 500],
    ]
  );
  assert.ok(payOverage.overage_obligation_id);
  const paidOverageObligation = await db.query(
    'SELECT direction, principal_minor FROM fortuna_private.financial_obligations WHERE id = $1',
    [payOverage.overage_obligation_id]
  );
  assert.equal(paidOverageObligation.rows[0].direction, 'receivable');
  assert.equal(Number(paidOverageObligation.rows[0].principal_minor), 1000);
  assert.equal(await balance(ids.p1), 0n);
  assert.equal(await balance(ids.p2), 0n);
  assert.equal(await balance(receiveOverage.overage_obligation_id), 0n);
  assert.equal(await balance(payOverage.overage_obligation_id), 1000n);
  const payLedger = await scalar(
    'SELECT COALESCE(sum(signed_minor), 0)::bigint AS value FROM fortuna_private.financial_ledger_entries WHERE event_id = $1',
    [payOverage.event_id]
  );
  assert.equal(BigInt(payLedger), 6000n);
  console.log('PASS — confirmed paid overage creates only the opposite receivable and reconciles the full cash amount');

  const finalCounts = await counts();
  assert.equal(Number(finalCounts.obligations), 7);
  assert.equal(Number(finalCounts.events), 10);
  assert.equal(Number(finalCounts.allocations), 10);
  assert.equal(Number(finalCounts.ledger), 17);
  assert.equal(Number(finalCounts.audit), 5);
  assert.equal(Number(finalCounts.idempotency), 5);
  console.log('PASS — no settlement over-applies a receivable or payable; all successful operations are idempotent and reconciled');
  console.log('PASS — FORTUNA isolated FIFO/manual/overage operation verification complete');
} finally {
  try {
    await db.exec('RESET ROLE');
  } catch {
    // RESET ROLE is unavailable if SET ROLE was never reached or the connection closed.
  }
  await db.close();
}
