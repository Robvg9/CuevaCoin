import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const schemaPath = process.env.FORTUNA_SQL_FILE;
const operationsPath = process.env.FORTUNA_OPERATIONS_SQL_FILE;
if (!schemaPath) throw new Error('FORTUNA_SQL_FILE must point to the isolated schema prototype');
if (!operationsPath) throw new Error('FORTUNA_OPERATIONS_SQL_FILE must point to the isolated owner API operations prototype');

const [schemaSql, operationsSql] = await Promise.all([
  readFile(schemaPath, 'utf8'),
  readFile(operationsPath, 'utf8'),
]);
const db = new PGlite();

const ids = {
  owner1: '10000000-0000-4000-8000-000000000001',
  owner2: '10000000-0000-4000-8000-000000000002',
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

async function createContact({ name, phone = null, notes = null, key }) {
  const result = await db.query(
    'SELECT api.create_contact($1, $2, $3, $4) AS value',
    [name, phone, notes, key]
  );
  return asJson(result.rows[0].value);
}

async function openObligation({
  contactId,
  direction,
  currency = 'CUP',
  amountMinor,
  description,
  dueAt = null,
  key,
}) {
  const result = await db.query(
    'SELECT api.open_obligation($1, $2, $3, $4, $5, $6, $7) AS value',
    [contactId, direction, currency, amountMinor, description, dueAt, key]
  );
  return asJson(result.rows[0].value);
}

async function listContacts() {
  const result = await db.query('SELECT api.list_contacts() AS value');
  return asJson(result.rows[0].value);
}

async function listObligations(contactId, currency = null, direction = null) {
  const result = await db.query(
    'SELECT api.list_obligations($1, $2, $3) AS value',
    [contactId, currency, direction]
  );
  return asJson(result.rows[0].value);
}

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0]?.value;
}

// Read internal fixture state as the verifier role, then restore the caller role.
// Direct table reads under authenticated must remain denied by design.
async function privilegedScalar(sql, params = []) {
  await db.exec('RESET ROLE');
  try {
    return await scalar(sql, params);
  } finally {
    await db.exec('SET ROLE authenticated');
  }
}

try {
  const version = await scalar('SELECT version() AS value');
  assert.match(String(version), /PostgreSQL 17/i);
  console.log('PASS — owner API operations engine: ' + version);

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

  await db.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [ids.owner1, ids.owner2]);
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
  console.log('PASS — isolated owners and fixed CUP/USD/EUR currency catalog seeded');

  const privileges = await db.query(`
    SELECT
      has_schema_privilege('anon', 'api', 'USAGE') AS anon_api_usage,
      has_schema_privilege('authenticated', 'api', 'USAGE') AS authenticated_api_usage,
      has_schema_privilege('authenticated', 'fortuna_private', 'USAGE') AS authenticated_private_usage,
      has_table_privilege('authenticated', 'fortuna_private.financial_books', 'SELECT') AS auth_book_select,
      has_table_privilege('authenticated', 'fortuna_private.financial_contacts', 'INSERT') AS auth_contact_insert,
      has_table_privilege('authenticated', 'fortuna_private.financial_obligations', 'INSERT') AS auth_obligation_insert,
      has_function_privilege('anon', 'api.create_contact(text,text,text,text)', 'EXECUTE') AS anon_create_execute,
      has_function_privilege('authenticated', 'api.create_contact(text,text,text,text)', 'EXECUTE') AS auth_create_execute,
      has_function_privilege('authenticated', 'api.open_obligation(uuid,text,text,text,text,timestamp with time zone,text)', 'EXECUTE') AS auth_open_execute,
      has_function_privilege('authenticated', 'api.list_contacts()', 'EXECUTE') AS auth_list_execute
  `);
  assert.deepEqual(privileges.rows[0], {
    anon_api_usage: false,
    authenticated_api_usage: true,
    authenticated_private_usage: true,
    auth_book_select: false,
    auth_contact_insert: false,
    auth_obligation_insert: false,
    anon_create_execute: false,
    auth_create_execute: true,
    auth_open_execute: true,
    auth_list_execute: true,
  });
  console.log('PASS — minimal API grants and no direct financial-table privileges');

  const functionCatalog = await db.query(`
    SELECT n.nspname AS schema_name, p.proname, p.prosecdef, p.pronargs,
           COALESCE(p.proargnames, ARRAY[]::text[]) AS arg_names,
           COALESCE(p.proconfig, ARRAY[]::text[]) AS settings
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE (n.nspname = 'api' AND p.proname IN ('create_contact', 'open_obligation', 'list_contacts'))
        OR (n.nspname = 'fortuna_private' AND p.proname LIKE 'fortuna_%')
     ORDER BY n.nspname, p.proname
  `);
  assert.equal(functionCatalog.rows.length, 8);
  for (const row of functionCatalog.rows.filter(row => row.schema_name === 'api')) {
    assert.equal(row.prosecdef, false, row.proname + ' must be SECURITY INVOKER');
    assert.ok(row.settings.includes('search_path=pg_catalog'));
    assert.ok(!row.arg_names.some(name => ['owner_user_id', 'actor_user_id', 'user_id', 'book_id'].includes(name)));
  }
  for (const row of functionCatalog.rows.filter(row => row.schema_name === 'fortuna_private')) {
    assert.equal(row.prosecdef, true, row.proname + ' must be SECURITY DEFINER');
    assert.ok(row.settings.includes('search_path=pg_catalog'));
    assert.ok(!row.arg_names.some(name => ['owner_user_id', 'actor_user_id', 'user_id', 'book_id'].includes(name)));
  }
  console.log('PASS — wrappers are SECURITY INVOKER; owner-checked private helpers are SECURITY DEFINER with fixed search_path');

  await authenticateAs(ids.owner1);
  const created = await createContact({
    name: '  Contacto mixto  ',
    phone: ' 555-0100 ',
    notes: '  Cliente de prueba ',
    key: 'contact-create-0001',
  });
  assert.ok(created.contact_id);
  assert.equal(created.display_name, 'Contacto mixto');
  assert.equal(created.phone, '555-0100');
  assert.equal(created.notes, 'Cliente de prueba');
  assert.equal(Number(await privilegedScalar('SELECT count(*)::int AS value FROM fortuna_private.financial_books')), 1);
  assert.equal(Number(await privilegedScalar('SELECT count(*)::int AS value FROM fortuna_private.financial_contacts')), 1);
  console.log('PASS — first owner write creates exactly one personal book and one normalized contact');

  const contactReplay = await createContact({
    name: 'Contacto mixto',
    phone: '555-0100',
    notes: 'Cliente de prueba',
    key: 'contact-create-0001',
  });
  assert.deepEqual(contactReplay, created, 'same key and payload must return stored result');
  assert.equal(Number(await privilegedScalar('SELECT count(*)::int AS value FROM fortuna_private.financial_contacts')), 1);
  assert.equal(Number(await privilegedScalar("SELECT count(*)::int AS value FROM fortuna_private.financial_audit WHERE action = 'contact_created'")), 1);
  console.log('PASS — create-contact retry is idempotent and creates no duplicate contact or audit row');

  await expectFailure(
    'same contact idempotency key with changed payload is rejected',
    () => createContact({
      name: 'Nombre distinto',
      phone: '555-0100',
      notes: 'Cliente de prueba',
      key: 'contact-create-0001',
    }),
    /fortuna_idempotency_conflict/i
  );
  assert.equal(Number(await privilegedScalar('SELECT count(*)::int AS value FROM fortuna_private.financial_contacts')), 1);

  const receivable = await openObligation({
    contactId: created.contact_id,
    direction: 'receivable',
    currency: 'cup',
    amountMinor: '12500',
    description: 'Préstamo inicial',
    dueAt: '2026-12-15T12:00:00Z',
    key: 'obligation-open-0001',
  });
  assert.ok(receivable.event_id);
  assert.ok(receivable.obligation_id);
  assert.equal(receivable.currency, 'CUP');
  assert.equal(receivable.signed_minor, '12500');
  const receivableReplay = await openObligation({
    contactId: created.contact_id,
    direction: 'receivable',
    currency: 'CUP',
    amountMinor: '12500',
    description: 'Préstamo inicial',
    dueAt: '2026-12-15T12:00:00Z',
    key: 'obligation-open-0001',
  });
  assert.deepEqual(receivableReplay, receivable);
  assert.equal(Number(await privilegedScalar('SELECT count(*)::int AS value FROM fortuna_private.financial_events')), 1);
  console.log('PASS — opening a receivable writes one event and one ledger line; same-key replay does not duplicate');

  await expectFailure(
    'same obligation idempotency key with changed amount is rejected',
    () => openObligation({
      contactId: created.contact_id,
      direction: 'receivable',
      currency: 'CUP',
      amountMinor: '13000',
      description: 'Préstamo inicial',
      dueAt: '2026-12-15T12:00:00Z',
      key: 'obligation-open-0001',
    }),
    /fortuna_idempotency_conflict/i
  );
  await expectFailure(
    'minor-unit API rejects decimal input rather than rounding',
    () => openObligation({
      contactId: created.contact_id,
      direction: 'receivable',
      currency: 'CUP',
      amountMinor: '125.50',
      description: 'Precisión no permitida',
      key: 'obligation-invalid-0001',
    }),
    /fortuna_amount_minor_invalid/i
  );
  await expectFailure(
    'v1 currency allowlist rejects unsupported currency',
    () => openObligation({
      contactId: created.contact_id,
      direction: 'receivable',
      currency: 'JPY',
      amountMinor: '100',
      description: 'Moneda no permitida',
      key: 'obligation-invalid-0002',
    }),
    /fortuna_currency_not_supported/i
  );
  await expectFailure(
    'amount outside PostgreSQL bigint range is rejected',
    () => openObligation({
      contactId: created.contact_id,
      direction: 'receivable',
      currency: 'CUP',
      amountMinor: '9999999999999999999',
      description: 'Fuera de rango',
      key: 'obligation-invalid-0003',
    }),
    /fortuna_amount_minor_invalid/i
  );

  const payable = await openObligation({
    contactId: created.contact_id,
    direction: 'payable',
    currency: 'CUP',
    amountMinor: '4000',
    description: 'Pago pendiente',
    key: 'obligation-open-0002',
  });
  assert.equal(payable.signed_minor, '-4000');

  const usd = await openObligation({
    contactId: created.contact_id,
    direction: 'receivable',
    currency: 'USD',
    amountMinor: '20000',
    description: 'Compra en USD',
    key: 'obligation-open-0003',
  });
  assert.equal(usd.signed_minor, '20000');

  const contacts = await listContacts();
  assert.equal(contacts.length, 1, 'a contact with several obligations must appear in one card');
  assert.equal(contacts[0].contact_id, created.contact_id);
  assert.equal(contacts[0].display_name, 'Contacto mixto');
  assert.equal(contacts[0].currencies.length, 2, 'currency positions must remain separate');
  const cup = contacts[0].currencies.find(item => item.currency === 'CUP');
  const usdPosition = contacts[0].currencies.find(item => item.currency === 'USD');
  assert.ok(cup);
  assert.equal(cup.te_debe_minor, '12500');
  assert.equal(cup.le_debes_minor, '4000');
  assert.equal(cup.position_type, 'mixed');
  assert.ok(usdPosition);
  assert.equal(usdPosition.te_debe_minor, '20000');
  assert.equal(usdPosition.le_debes_minor, '0');
  assert.equal(usdPosition.position_type, 'receivable');
  const cupObligations = await listObligations(created.contact_id, 'CUP');
  assert.equal(cupObligations.length, 2);
  assert.equal(cupObligations[0].description, 'Deuda inicial');
  assert.equal(cupObligations[0].principal_minor, '16500');
  assert.equal(cupObligations[0].remaining_minor, '16500');
  assert.equal(cupObligations[0].direction, 'receivable');
  assert.equal(cupObligations[0].currency, 'CUP');
  assert.ok(Object.hasOwn(cupObligations[0], 'due_at'));
  const receivables = await listObligations(created.contact_id, 'CUP', 'receivable');
  assert.equal(receivables.length, 1);
  assert.equal((await listObligations(created.contact_id, 'EUR')).length, 0);
  console.log('PASS — owner-only obligation detail query returns description, due date, currency, direction and remaining minor units with filters');

  console.log('PASS — one contact card exposes separate gross receivable/payable values per currency without FX/netting');

  await expectFailure(
    'a different owner cannot open an obligation against another book contact',
    async () => {
      await authenticateAs(ids.owner2);
      return openObligation({
        contactId: created.contact_id,
        direction: 'receivable',
        currency: 'CUP',
        amountMinor: '100',
        description: 'Cross-owner attempt',
        key: 'cross-owner-write-0001',
      });
    },
    /fortuna_contact_not_found/i
  );
  assert.equal(Number(await privilegedScalar(
    'SELECT count(*)::int AS value FROM fortuna_private.financial_obligations WHERE contact_id = $1',
    [created.contact_id]
  )), 3);
  await expectFailure(
    'a different owner cannot enumerate another book obligations by contact ID',
    () => listObligations(created.contact_id),
    /fortuna_contact_not_found/i
  );
  const owner2Contacts = await listContacts();
  assert.deepEqual(owner2Contacts, []);
  console.log('PASS — cross-owner resource ID is non-enumerating and creates no financial rows');

  const owner2Contact = await createContact({
    name: 'Libro del administrador global',
    key: 'owner2-contact-0001',
  });
  assert.ok(owner2Contact.contact_id);
  const owner2BookId = await privilegedScalar(
    'SELECT id AS value FROM fortuna_private.financial_books WHERE owner_user_id = $1',
    [ids.owner2]
  );
  assert.ok(owner2BookId);
  const owner2List = await listContacts();
  assert.equal(owner2List.length, 1);
  assert.equal(owner2List[0].contact_id, owner2Contact.contact_id);
  assert.notEqual(owner2List[0].contact_id, created.contact_id);
  console.log('PASS — global CuevaCoin administrator fixture can access only its own personal FORTUNA book');

  await expectFailure(
    'RPC function surface does not accept a caller-supplied owner ID',
    () => db.query(
      'SELECT api.create_contact($1, $2, $3, $4, $5::uuid)',
      ['Other', null, null, 'owner-forgery-0001', ids.owner1]
    ),
    /function .* does not exist/i
  );

  await db.exec('RESET ROLE; SET ROLE authenticated;');
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await expectFailure(
    'authenticated database role without a subject cannot call the owner API',
    () => listContacts(),
    /fortuna_auth_required/i
  );

  await db.exec('RESET ROLE; SET ROLE anon;');
  await expectFailure(
    'anon cannot invoke the FORTUNA API wrapper',
    () => db.query('SELECT api.list_contacts()'),
    /permission denied|schema/i
  );

  await db.exec('RESET ROLE;');
  const finalAccess = await db.query(`
    SELECT
      has_table_privilege('anon', 'fortuna_private.financial_contacts', 'SELECT') AS anon_select,
      has_table_privilege('authenticated', 'fortuna_private.financial_contacts', 'SELECT') AS authenticated_select,
      has_table_privilege('authenticated', 'fortuna_private.financial_contacts', 'INSERT') AS authenticated_insert,
      (SELECT count(*)::int FROM fortuna_private.financial_books) AS book_count,
      (SELECT count(*)::int FROM fortuna_private.financial_contacts) AS contact_count,
      (SELECT count(*)::int FROM fortuna_private.financial_obligations) AS obligation_count,
      (SELECT count(*)::int FROM fortuna_private.financial_events) AS event_count,
      (SELECT count(*)::int FROM fortuna_private.financial_ledger_entries) AS ledger_count
  `);
  assert.deepEqual(finalAccess.rows[0], {
    anon_select: false,
    authenticated_select: false,
    authenticated_insert: false,
    book_count: 2,
    contact_count: 2,
    obligation_count: 3,
    event_count: 3,
    ledger_count: 3,
  });
  console.log('PASS — no direct client table grants; persisted totals reconcile with the tested commands');
  console.log('PASS — isolated owner-only FORTUNA core API operations verification complete');
} finally {
  try {
    await db.exec('RESET ROLE');
  } catch {
    // The test may fail before SET ROLE is reached.
  }
  await db.close();
}
