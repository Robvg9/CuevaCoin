import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const schemaPath = process.env.FORTUNA_SQL_FILE;
const operationsPath = process.env.FORTUNA_OPERATIONS_SQL_FILE;
const settlementApiPath = process.env.FORTUNA_SETTLEMENT_API_SQL_FILE;
for (const [name, value] of [
  ['FORTUNA_SQL_FILE', schemaPath],
  ['FORTUNA_OPERATIONS_SQL_FILE', operationsPath],
  ['FORTUNA_SETTLEMENT_API_SQL_FILE', settlementApiPath],
]) {
  if (!value) throw new Error(name + ' must point to an isolated SQL prototype');
}

const [schemaSql, operationsSql, settlementApiSql] = await Promise.all([
  readFile(schemaPath, 'utf8'),
  readFile(operationsPath, 'utf8'),
  readFile(settlementApiPath, 'utf8'),
]);
const db = new PGlite();

const ids = {
  owner1: '10000000-0000-4000-8000-000000000001',
  owner2: '10000000-0000-4000-8000-000000000002',
  owner3: '10000000-0000-4000-8000-000000000003',
};

function asJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function expectFailure(label, operation, pattern) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, label + ': expected the operation to fail');
  if (pattern) assert.match(String(caught.message || caught), pattern, label);
  console.log('PASS — ' + label);
}

async function authenticateAs(userId) {
  await db.exec('RESET ROLE; SET ROLE authenticated;');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0]?.value;
}

// Test fixture reads use the verifier role. Authenticated must not have table access.
async function privilegedQuery(sql, params = []) {
  await db.exec('RESET ROLE');
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('SET ROLE authenticated');
  }
}

async function createContact(name, key, userId = ids.owner1) {
  if (userId !== ids.owner1) await authenticateAs(userId);
  const result = await db.query(
    'SELECT api.create_contact($1, NULL, NULL, $2) AS value',
    [name, key]
  );
  return asJson(result.rows[0].value);
}

async function openObligation({
  contactId, direction, amountMinor, key, currency = 'CUP', description = 'Test obligation',
}) {
  const result = await db.query(
    'SELECT api.open_obligation($1, $2, $3, $4, $5, NULL, $6) AS value',
    [contactId, direction, currency, String(amountMinor), description, key]
  );
  return asJson(result.rows[0].value);
}

async function preview({
  contactId, flow, mode = 'fifo', totalMinor, currency = 'CUP', allocations = [],
}) {
  const result = await db.query(
    'SELECT api.preview_settlement($1, $2, $3, $4, $5, $6::jsonb) AS value',
    [contactId, currency, flow, mode, String(totalMinor), JSON.stringify(allocations)]
  );
  return asJson(result.rows[0].value);
}

async function commit({
  contactId, flow, mode = 'fifo', totalMinor, currency = 'CUP', allocations = [],
  fingerprint, confirmOverage = false, key,
}) {
  const fn = flow === 'cash_received' ? 'api.receive_cash' : 'api.pay_contact';
  const result = await db.query(
    `SELECT ${fn}($1, $2, $3, $4, $5::jsonb, $6, $7, $8) AS value`,
    [
      contactId, currency, mode, String(totalMinor), JSON.stringify(allocations),
      fingerprint, confirmOverage, key,
    ]
  );
  return asJson(result.rows[0].value);
}

async function counts() {
  const result = await privilegedQuery(`
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

async function balance(obligationId) {
  const result = await privilegedQuery(
    'SELECT COALESCE(sum(signed_minor), 0)::bigint AS value FROM fortuna_private.financial_ledger_entries WHERE obligation_id = $1',
    [obligationId]
  );
  return BigInt(result.rows[0]?.value ?? 0);
}

try {
  const version = await scalar('SELECT version() AS value');
  assert.match(String(version), /PostgreSQL 17/i);
  console.log('PASS — settlement API engine: ' + version);

  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.perfiles (id uuid PRIMARY KEY);
    CREATE TABLE public.cuevacoin_global_admin_fixture (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id),
      is_global_admin boolean NOT NULL DEFAULT false
    );
  `);
  await db.exec(schemaSql);
  await db.exec(operationsSql);
  await db.exec(settlementApiSql);
  await db.query('INSERT INTO auth.users (id) VALUES ($1), ($2), ($3)', [ids.owner1, ids.owner2, ids.owner3]);
  await db.query(
    'INSERT INTO public.cuevacoin_global_admin_fixture (user_id, is_global_admin) VALUES ($1, true)',
    [ids.owner2]
  );
  await db.exec(`
    INSERT INTO fortuna_private.financial_currencies (code, display_name, minor_unit_scale)
    VALUES ('CUP', 'Peso cubano (fixture)', 2),
           ('USD', 'US dollar (fixture)', 2),
           ('EUR', 'Euro (fixture)', 2);
  `);
  console.log('PASS — schema, core owner API and settlement API overlays loaded');

  const privileges = await db.query(`
    SELECT
      has_schema_privilege('anon', 'api', 'USAGE') AS anon_api_usage,
      has_schema_privilege('authenticated', 'api', 'USAGE') AS auth_api_usage,
      has_table_privilege('authenticated', 'fortuna_private.financial_obligations', 'SELECT') AS auth_obligation_select,
      has_table_privilege('authenticated', 'fortuna_private.financial_ledger_entries', 'INSERT') AS auth_ledger_insert,
      has_function_privilege('anon', 'api.preview_settlement(uuid,text,text,text,text,jsonb)', 'EXECUTE') AS anon_preview,
      has_function_privilege('authenticated', 'api.preview_settlement(uuid,text,text,text,text,jsonb)', 'EXECUTE') AS auth_preview,
      has_function_privilege('authenticated', 'api.receive_cash(uuid,text,text,text,jsonb,text,boolean,text)', 'EXECUTE') AS auth_receive,
      has_function_privilege('authenticated', 'api.pay_contact(uuid,text,text,text,jsonb,text,boolean,text)', 'EXECUTE') AS auth_pay,
      has_function_privilege('authenticated', 'fortuna_private.fortuna_calculate_settlement_plan(uuid,uuid,text,text,text,text,jsonb)', 'EXECUTE') AS auth_internal_plan
  `);
  assert.deepEqual(privileges.rows[0], {
    anon_api_usage: false,
    auth_api_usage: true,
    auth_obligation_select: false,
    auth_ledger_insert: false,
    anon_preview: false,
    auth_preview: true,
    auth_receive: true,
    auth_pay: true,
    auth_internal_plan: false,
  });
  console.log('PASS — API grants are minimal; anon denied; no direct financial-table or internal-plan access');
  await authenticateAs(ids.owner1);
  await expectFailure(
    'authenticated owner cannot query private financial ledger tables directly',
    () => db.query('SELECT count(*) FROM fortuna_private.financial_ledger_entries'),
    /permission denied/i
  );

  const functions = await db.query(`
    SELECT n.nspname AS schema_name, p.proname, p.prosecdef, p.pronargs,
           COALESCE(p.proargnames, ARRAY[]::text[]) AS arg_names,
           COALESCE(p.proconfig, ARRAY[]::text[]) AS settings
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE (n.nspname = 'api' AND p.proname IN ('preview_settlement','receive_cash','pay_contact'))
        OR (n.nspname = 'fortuna_private' AND p.proname IN ('fortuna_preview_settlement','fortuna_commit_settlement'))
  `);
  assert.equal(functions.rows.length, 5);
  for (const fn of functions.rows) {
    assert.ok(fn.settings.includes('search_path=pg_catalog'));
    assert.ok(!fn.arg_names.some(name => ['owner_user_id','actor_user_id','user_id','book_id'].includes(name)));
    assert.equal(fn.prosecdef, fn.schema_name === 'fortuna_private');
  }
  console.log('PASS — invoker API wrappers and fixed-search_path private definer facades accept no caller identity/book parameters');

  await authenticateAs(ids.owner1);
  const contact = await createContact('Settlement owner one', 'settlement-contact-0001');
  const contactId = contact.contact_id;
  const receivable1 = await openObligation({
    contactId, direction: 'receivable', amountMinor: '300000',
    key: 'settlement-open-rec-0001', description: 'Older receivable',
  });
  const receivable2 = await openObligation({
    contactId, direction: 'receivable', amountMinor: '500000',
    key: 'settlement-open-rec-0002', description: 'Newer receivable',
  });
  const payable1 = await openObligation({
    contactId, direction: 'payable', amountMinor: '400000',
    key: 'settlement-open-pay-0001', description: 'Payable A',
  });
  const payable2 = await openObligation({
    contactId, direction: 'payable', amountMinor: '300000',
    key: 'settlement-open-pay-0002', description: 'Payable B',
  });
  console.log('PASS — test owner opened two receivables and two payables through owner-scoped RPCs');

  const fifoPreview = await preview({
    contactId, flow: 'cash_received', totalMinor: '400000',
  });
  assert.match(fifoPreview.preview_fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    fifoPreview.allocations.map(x => [x.obligation_id, Number(x.amount_minor)]),
    [[receivable1.obligation_id, 300000], [receivable2.obligation_id, 100000]]
  );
  assert.equal(fifoPreview.allocated_minor, '400000');
  assert.equal(fifoPreview.overage_minor, '0');
  assert.equal(fifoPreview.overage_direction, null);
  console.log('PASS — FIFO preview proposes oldest-first allocations and returns a SHA-256 fingerprint');

  const fifoArgs = {
    contactId, flow: 'cash_received', totalMinor: '400000',
    fingerprint: fifoPreview.preview_fingerprint, key: 'settlement-receive-0001',
  };
  const fifoCommit = await commit(fifoArgs);
  assert.equal(fifoCommit.allocated_minor, '400000');
  assert.equal(fifoCommit.overage_minor, '0');
  assert.equal(await balance(receivable1.obligation_id), 0n);
  assert.equal(await balance(receivable2.obligation_id), 400000n);
  const afterFifo = await counts();
  const fifoReplay = await commit(fifoArgs);
  assert.deepEqual(fifoReplay, fifoCommit);
  assert.deepEqual(await counts(), afterFifo);
  console.log('PASS — confirmed FIFO receipt commits ledger/allocation atomically and exact retry replays without duplicates');

  await expectFailure(
    'same settlement idempotency key with changed cash amount is rejected',
    () => commit({ ...fifoArgs, totalMinor: '410000' }),
    /fortuna_idempotency_conflict/i
  );
  assert.deepEqual(await counts(), afterFifo);

  const manualPlan = [
    { obligation_id: payable1.obligation_id, amount_minor: '100000' },
    { obligation_id: payable2.obligation_id, amount_minor: '50000' },
  ];
  const manualPreview = await preview({
    contactId, flow: 'cash_paid', mode: 'manual', totalMinor: '150000',
    allocations: manualPlan,
  });
  assert.equal(manualPreview.allocated_minor, '150000');
  assert.equal(manualPreview.overage_minor, '0');
  assert.deepEqual(
    manualPreview.allocations.map(x => [x.obligation_id, x.amount_minor]),
    manualPlan.slice().sort((a,b)=>a.obligation_id.localeCompare(b.obligation_id)).map(x=>[x.obligation_id,x.amount_minor])
  );
  const manualArgs = {
    contactId, flow: 'cash_paid', mode: 'manual', totalMinor: '150000',
    allocations: manualPlan, fingerprint: manualPreview.preview_fingerprint,
    key: 'settlement-pay-manual-001',
  };
  const manualCommit = await commit(manualArgs);
  assert.equal(await balance(payable1.obligation_id), -300000n);
  assert.equal(await balance(payable2.obligation_id), -250000n);
  await expectFailure(
    'manual allocation total cannot exceed the cash amount',
    () => preview({
      contactId, flow: 'cash_paid', mode: 'manual', totalMinor: '150000',
      allocations: [{ obligation_id: payable1.obligation_id, amount_minor: '150001' }],
    }),
    /fortuna_settlement_allocations_exceed_cash_amount/i
  );
  console.log('PASS — manual payment applies bounded allocations and preserves payable sign convention');

  const staleContact = await createContact('Stale preview isolated contact', 'settlement-contact-stale-01');
  const staleObligation = await openObligation({
    contactId: staleContact.contact_id,
    direction: 'receivable',
    amountMinor: '1000',
    key: 'settlement-open-stale-0001',
    description: 'Stale preview receivable',
  });
  const stalePreview = await preview({
    contactId: staleContact.contact_id, flow: 'cash_received', totalMinor: '800',
  });
  const interleavingPreview = await preview({
    contactId: staleContact.contact_id, flow: 'cash_received', totalMinor: '200',
  });
  const interleavingCommit = await commit({
    contactId: staleContact.contact_id, flow: 'cash_received', totalMinor: '200',
    fingerprint: interleavingPreview.preview_fingerprint,
    key: 'settlement-interleave-0001',
  });
  const beforeStale = await counts();
  await expectFailure(
    'changed balances between preview and confirm reject stale fingerprint',
    () => commit({
      contactId: staleContact.contact_id, flow: 'cash_received', totalMinor: '800',
      fingerprint: stalePreview.preview_fingerprint,
      key: 'settlement-stale-attempt-001',
    }),
    /fortuna_stale_preview/i
  );
  assert.deepEqual(await counts(), beforeStale);
  assert.equal(await balance(staleObligation.obligation_id), 800n);
  assert.ok(interleavingCommit.event_id);
  console.log('PASS — stale preview detects an intervening settlement and creates no event, allocation, ledger or idempotency rows');

  const overageContact = await createContact('Overage isolated contact', 'settlement-contact-overage-01');
  const overageObligation = await openObligation({
    contactId: overageContact.contact_id,
    direction: 'receivable',
    amountMinor: '500',
    key: 'settlement-open-overage-0001',
    description: 'Overage preview receivable',
  });
  const overagePreview = await preview({
    contactId: overageContact.contact_id, flow: 'cash_received', totalMinor: '100000',
  });
  assert.equal(overagePreview.overage_minor, '99500');
  assert.equal(overagePreview.overage_direction, 'payable');
  const beforeUnconfirmed = await counts();
  await expectFailure(
    'cash received above open receivables requires explicit owner confirmation',
    () => commit({
      contactId: overageContact.contact_id, flow: 'cash_received', totalMinor: '100000',
      fingerprint: overagePreview.preview_fingerprint,
      confirmOverage: false, key: 'settlement-overage-test-001',
    }),
    /fortuna_overage_confirmation_required/i
  );
  assert.deepEqual(await counts(), beforeUnconfirmed);
  const overageCommit = await commit({
    contactId: overageContact.contact_id, flow: 'cash_received', totalMinor: '100000',
    fingerprint: overagePreview.preview_fingerprint,
    confirmOverage: true, key: 'settlement-overage-commit-01',
  });
  assert.equal(overageCommit.overage_minor, '99500');
  assert.ok(overageCommit.overage_obligation_id);
  const overageRow = await privilegedQuery(
    'SELECT direction, principal_minor FROM fortuna_private.financial_obligations WHERE id = $1',
    [overageCommit.overage_obligation_id]
  );
  assert.equal(overageRow.rows[0].direction, 'payable');
  assert.equal(Number(overageRow.rows[0].principal_minor), 99500);
  assert.ok(overageObligation.obligation_id);
  console.log('PASS — confirmed excess creates the opposite payable; unconfirmed excess leaves all counts unchanged');

  const payOverageContact = await createContact('Paid overage isolated contact', 'settlement-contact-pay-overage');
  const payOverageObligation = await openObligation({
    contactId: payOverageContact.contact_id,
    direction: 'payable',
    amountMinor: '700',
    key: 'settlement-open-pay-overage-0001',
    description: 'Paid overage payable',
  });
  const payOveragePreview = await preview({
    contactId: payOverageContact.contact_id, flow: 'cash_paid', totalMinor: '1000',
  });
  assert.equal(payOveragePreview.overage_minor, '300');
  assert.equal(payOveragePreview.overage_direction, 'receivable');
  const payOverageCommit = await commit({
    contactId: payOverageContact.contact_id, flow: 'cash_paid', totalMinor: '1000',
    fingerprint: payOveragePreview.preview_fingerprint,
    confirmOverage: true, key: 'settlement-pay-overage-commit-01',
  });
  assert.equal(payOverageCommit.overage_minor, '300');
  assert.ok(payOverageCommit.overage_obligation_id);
  const payOverageRow = await privilegedQuery(
    'SELECT direction, principal_minor FROM fortuna_private.financial_obligations WHERE id = $1',
    [payOverageCommit.overage_obligation_id]
  );
  assert.equal(payOverageRow.rows[0].direction, 'receivable');
  assert.equal(Number(payOverageRow.rows[0].principal_minor), 300);
  assert.ok(payOverageObligation.obligation_id);
  console.log('PASS — confirmed paid excess creates the opposite receivable');

  // Give each principal a real personal book before testing cross-book isolation.
  // Without this setup, the owner lookup correctly returns fortuna_book_not_found
  // before the contact-ownership check can be exercised.
  const owner2Contact = await createContact(
    'Global admin own book',
    'settlement-contact-owner2',
    ids.owner2
  );
  const owner3Contact = await createContact(
    'Ordinary owner own book',
    'settlement-contact-owner3',
    ids.owner3
  );
  const beforeCrossOwnerAttempts = await counts();

  await expectFailure(
    'ordinary owner with an existing book cannot preview another owner contact',
    async () => {
      await authenticateAs(ids.owner3);
      return preview({ contactId, flow: 'cash_received', totalMinor: '100' });
    },
    /fortuna_settlement_resource_not_found/i
  );
  await expectFailure(
    'ordinary owner with an existing book cannot confirm another owner settlement',
    async () => {
      await authenticateAs(ids.owner3);
      return commit({
        contactId,
        flow: 'cash_received',
        totalMinor: '100',
        fingerprint: fifoPreview.preview_fingerprint,
        key: 'settlement-cross-owner-owner3-01',
      });
    },
    /fortuna_settlement_resource_not_found/i
  );

  await authenticateAs(ids.owner2);
  await expectFailure(
    'global administrator fixture with an existing book cannot preview another owner contact',
    () => preview({ contactId, flow: 'cash_received', totalMinor: '100' }),
    /fortuna_settlement_resource_not_found/i
  );
  await expectFailure(
    'global administrator fixture with an existing book cannot confirm another owner settlement',
    () => commit({
      contactId,
      flow: 'cash_received',
      totalMinor: '100',
      fingerprint: fifoPreview.preview_fingerprint,
      key: 'settlement-cross-owner-admin-01',
    }),
    /fortuna_settlement_resource_not_found/i
  );
  assert.deepEqual(
    await counts(),
    beforeCrossOwnerAttempts,
    'cross-owner preview/confirm attempts must not create financial or idempotency rows'
  );

  const owner2Plan = await preview({
    contactId: owner2Contact.contact_id, flow: 'cash_received', totalMinor: '100',
  });
  assert.equal(owner2Plan.overage_minor, '100');
  assert.ok(owner3Contact.contact_id);
  console.log('PASS — ordinary owners and global administrators can access only their own FORTUNA books');

  await db.exec('RESET ROLE; SET ROLE anon;');
  await expectFailure(
    'anon cannot invoke settlement preview',
    () => db.query(
      'SELECT api.preview_settlement($1, $2, $3, $4, $5, $6::jsonb)',
      [contactId, 'CUP', 'cash_received', 'fifo', '100', '[]']
    ),
    /permission denied|schema/i
  );

  await db.exec('RESET ROLE; SET ROLE authenticated;');
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await expectFailure(
    'authenticated role without a subject cannot preview a settlement',
    () => preview({ contactId, flow: 'cash_received', totalMinor: '100' }),
    /fortuna_auth_required/i
  );

  const final = await privilegedQuery(`
    SELECT
      has_table_privilege('anon','fortuna_private.financial_events','SELECT') AS anon_select,
      has_table_privilege('authenticated','fortuna_private.financial_events','SELECT') AS auth_select,
      has_table_privilege('authenticated','fortuna_private.financial_events','INSERT') AS auth_insert
  `);
  assert.deepEqual(final.rows[0], { anon_select: false, auth_select: false, auth_insert: false });
  console.log('PASS — direct financial-table access remains denied after settlement operations');
  console.log('PASS — FORTUNA owner settlement preview/confirm verification complete');
} finally {
  try {
    await db.exec('RESET ROLE');
  } catch {
    // RESET ROLE is unavailable if SET ROLE was not reached.
  }
  await db.close();
}
