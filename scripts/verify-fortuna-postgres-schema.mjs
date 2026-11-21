import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const sqlPath = process.env.FORTUNA_SQL_FILE;
if (!sqlPath) throw new Error('FORTUNA_SQL_FILE must point to the isolated SQL prototype');

const schemaSql = await readFile(sqlPath, 'utf8');
const db = new PGlite();

async function expectFailure(label, operation, pattern = undefined) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected SQL failure: ${label}`);
  if (pattern) assert.match(String(caught.message || caught), pattern, label);
  console.log(`PASS — ${label}`);
}

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0]?.value;
}

try {
  const version = await scalar('SELECT version() AS value');
  assert.match(String(version), /PostgreSQL 17/i, 'PGlite must run PostgreSQL 17');
  console.log(`PASS — isolated engine: ${version}`);

  // Minimal stand-ins for Supabase-managed schemas/roles. They exist only in this
  // ephemeral PGlite instance and are never connected to the CuevaCoin project.
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.perfiles (id uuid PRIMARY KEY);
  `);

  await db.exec(schemaSql);
  console.log('PASS — schema prototype executes as PostgreSQL DDL');

  const requiredTables = [
    'financial_books',
    'financial_contacts',
    'financial_currencies',
    'financial_obligations',
    'financial_events',
    'financial_ledger_entries',
    'financial_allocations',
    'financial_idempotency',
    'financial_audit'
  ];

  const actualTables = await db.query(
    `SELECT tablename FROM pg_catalog.pg_tables
      WHERE schemaname = 'fortuna_private' ORDER BY tablename`
  );
  assert.deepEqual(
    actualTables.rows.map((row) => row.tablename).sort(),
    requiredTables.slice().sort(),
    'The prototype must create exactly the expected FORTUNA tables'
  );
  console.log(`PASS — all ${requiredTables.length} FORTUNA tables exist`);

  const rls = await db.query(
    `SELECT c.relname, c.relrowsecurity
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'fortuna_private'
        AND c.relkind = 'r'
      ORDER BY c.relname`
  );
  assert.equal(rls.rows.length, requiredTables.length);
  assert.ok(rls.rows.every((row) => row.relrowsecurity === true), 'RLS must be enabled on every table');
  console.log('PASS — RLS enabled across every FORTUNA table');

  const access = await db.query(`
    SELECT
      has_schema_privilege('anon', 'fortuna_private', 'USAGE') AS anon_schema,
      has_schema_privilege('authenticated', 'fortuna_private', 'USAGE') AS auth_schema,
      has_table_privilege('anon', 'fortuna_private.financial_books', 'SELECT') AS anon_table,
      has_table_privilege('authenticated', 'fortuna_private.financial_books', 'SELECT') AS auth_table,
      has_table_privilege('service_role', 'fortuna_private.financial_books', 'SELECT') AS service_table,
      has_table_privilege('service_role', 'fortuna_private.financial_books', 'UPDATE') AS update_book,
      has_table_privilege('service_role', 'fortuna_private.financial_contacts', 'UPDATE') AS update_contact_table,
      has_table_privilege('service_role', 'fortuna_private.financial_currencies', 'UPDATE') AS update_currency,
      has_table_privilege('service_role', 'fortuna_private.financial_obligations', 'UPDATE') AS update_obligation,
      has_table_privilege('service_role', 'fortuna_private.financial_events', 'UPDATE') AS update_event,
      has_table_privilege('service_role', 'fortuna_private.financial_ledger_entries', 'UPDATE') AS update_ledger,
      has_table_privilege('service_role', 'fortuna_private.financial_allocations', 'UPDATE') AS update_allocation,
      has_table_privilege('service_role', 'fortuna_private.financial_idempotency', 'UPDATE') AS update_idempotency_table,
      has_column_privilege('service_role', 'fortuna_private.financial_contacts', 'display_name', 'UPDATE') AS update_contact_name,
      has_column_privilege('service_role', 'fortuna_private.financial_contacts', 'linked_profile_id', 'UPDATE') AS update_contact_profile,
      has_column_privilege('service_role', 'fortuna_private.financial_contacts', 'book_id', 'UPDATE') AS update_contact_book,
      has_column_privilege('service_role', 'fortuna_private.financial_idempotency', 'actor_user_id', 'UPDATE') AS update_idempotency_actor,
      has_column_privilege('service_role', 'fortuna_private.financial_idempotency', 'status', 'UPDATE') AS update_idempotency_status,
      has_column_privilege('service_role', 'fortuna_private.financial_idempotency', 'payload_sha256', 'UPDATE') AS update_idempotency_hash,
      has_column_privilege('service_role', 'fortuna_private.financial_idempotency', 'idempotency_key', 'UPDATE') AS update_idempotency_key,
      has_table_privilege('service_role', 'fortuna_private.financial_audit', 'UPDATE') AS update_audit
  `);
  assert.deepEqual(access.rows[0], {
    anon_schema: false,
    auth_schema: false,
    anon_table: false,
    auth_table: false,
    service_table: true,
    update_book: false,
    update_contact_table: false,
    update_currency: false,
    update_obligation: false,
    update_event: false,
    update_ledger: false,
    update_allocation: false,
    update_idempotency_table: false,
    update_contact_name: true,
    update_contact_profile: true,
    update_contact_book: false,
    update_idempotency_actor: false,
    update_idempotency_status: true,
    update_idempotency_hash: false,
    update_idempotency_key: false,
    update_audit: false
  });
  console.log('PASS — Data API roles have no direct access; server UPDATE grants are column-scoped');

  const owner1 = '10000000-0000-4000-8000-000000000001';
  const owner2 = '10000000-0000-4000-8000-000000000002';
  const linkedProfile = '20000000-0000-4000-8000-000000000001';
  const book1 = '30000000-0000-4000-8000-000000000001';
  const book2 = '30000000-0000-4000-8000-000000000002';
  const contact1 = '40000000-0000-4000-8000-000000000001';
  const contact2 = '40000000-0000-4000-8000-000000000002';
  const obligation1 = '50000000-0000-4000-8000-000000000001';
  const openingEvent = '60000000-0000-4000-8000-000000000001';
  const cashEvent = '60000000-0000-4000-8000-000000000002';
  const reversalEvent = '60000000-0000-4000-8000-000000000003';
  const selfReversalEvent = '60000000-0000-4000-8000-000000000004';

  await db.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [owner1, owner2]);
  await db.query('INSERT INTO public.perfiles (id) VALUES ($1)', [linkedProfile]);
  await db.exec(`
    INSERT INTO fortuna_private.financial_currencies (code, display_name, minor_unit_scale)
    VALUES ('CUP', 'Peso cubano (fixture)', 2),
           ('USD', 'US dollar (fixture)', 2),
           ('EUR', 'Euro (fixture)', 2)
  `);

  await db.query(
    'INSERT INTO fortuna_private.financial_books (id, owner_user_id) VALUES ($1, $2), ($3, $4)',
    [book1, owner1, book2, owner2]
  );
  await expectFailure(
    'one book per owner is enforced',
    () => db.query('INSERT INTO fortuna_private.financial_books (owner_user_id) VALUES ($1)', [owner1]),
    /unique/i
  );

  await db.query(
    `INSERT INTO fortuna_private.financial_contacts (id, book_id, display_name, linked_profile_id)
     VALUES ($1, $2, 'Contacto externo', NULL), ($3, $2, 'Cuenta vinculada', $4)`,
    [contact1, book1, contact2, linkedProfile]
  );

  await expectFailure(
    'linked profile can appear only once per book',
    () => db.query(
      `INSERT INTO fortuna_private.financial_contacts (book_id, display_name, linked_profile_id)
       VALUES ($1, 'Duplicate linked profile', $2)`,
      [book1, linkedProfile]
    ),
    /unique/i
  );

  await db.query(
    `INSERT INTO fortuna_private.financial_obligations
      (id, book_id, contact_id, currency_code, direction, principal_minor, description, created_by)
     VALUES ($1, $2, $3, 'CUP', 'receivable', 12540, 'Préstamo fixture', $4)`,
    [obligation1, book1, contact1, owner1]
  );
  await expectFailure(
    'obligation amount must be positive',
    () => db.query(
      `INSERT INTO fortuna_private.financial_obligations
        (book_id, contact_id, currency_code, direction, principal_minor, description, created_by)
       VALUES ($1, $2, 'CUP', 'receivable', 0, 'invalid amount fixture', $3)`,
      [book1, contact1, owner1]
    ),
    /check constraint/i
  );
  await expectFailure(
    'unsupported currency precision is rejected',
    () => db.query(
      `INSERT INTO fortuna_private.financial_currencies (code, display_name, minor_unit_scale)
       VALUES ('JPY', 'Bad scale fixture', 7)`
    ),
    /check constraint/i
  );

  await db.query(
    `INSERT INTO fortuna_private.financial_events
      (id, book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id)
     VALUES ($1, $2, $3, 'CUP', 'obligation_opened', 12540, $4)`,
    [openingEvent, book1, contact1, owner1]
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_ledger_entries
      (book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor)
     VALUES ($1, $2, $3, 'CUP', $4, 'obligation_opened', 12540)`,
    [book1, openingEvent, contact1, obligation1]
  );

  await db.query(
    `INSERT INTO fortuna_private.financial_events
      (id, book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id)
     VALUES ($1, $2, $3, 'CUP', 'cash_received', 2540, $4)`,
    [cashEvent, book1, contact1, owner1]
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_allocations
      (book_id, event_id, obligation_id, contact_id, currency_code, amount_minor)
     VALUES ($1, $2, $3, $4, 'CUP', 2540)`,
    [book1, cashEvent, obligation1, contact1]
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_ledger_entries
      (book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor)
     VALUES ($1, $2, $3, 'CUP', $4, 'cash_received', -2540)`,
    [book1, cashEvent, contact1, obligation1]
  );
  await expectFailure(
    'event amount must be positive',
    () => db.query(
      `INSERT INTO fortuna_private.financial_events
        (book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id)
       VALUES ($1, $2, 'CUP', 'adjustment', 0, $3)`,
      [book1, contact1, owner1]
    ),
    /check constraint/i
  );
  await expectFailure(
    'every ledger entry must reference an obligation',
    () => db.query(
      `INSERT INTO fortuna_private.financial_ledger_entries
        (book_id, event_id, contact_id, currency_code, entry_kind, signed_minor)
       VALUES ($1, $2, $3, 'CUP', 'adjustment', 100)`,
      [book1, cashEvent, contact1]
    ),
    /not-null constraint/i
  );
  await expectFailure(
    'one event may have only one aggregated ledger line per obligation',
    () => db.query(
      `INSERT INTO fortuna_private.financial_ledger_entries
        (book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor)
       VALUES ($1, $2, $3, 'CUP', $4, 'cash_received', -100)`,
      [book1, cashEvent, contact1, obligation1]
    ),
    /unique/i
  );
  console.log('PASS — event amount and one-line-per-obligation ledger constraints');

  await expectFailure(
    'reversal cannot cross currencies',
    () => db.query(
      `INSERT INTO fortuna_private.financial_events
        (book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id, reverses_event_id, reversal_reason)
       VALUES ($1, $2, 'USD', 'reversal', 100, $3, $4, 'currency mismatch fixture')`,
      [book1, contact1, owner1, cashEvent]
    ),
    /foreign key/i
  );
  await expectFailure(
    'reversal cannot cross contacts',
    () => db.query(
      `INSERT INTO fortuna_private.financial_events
        (book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id, reverses_event_id, reversal_reason)
       VALUES ($1, $2, 'CUP', 'reversal', 100, $3, $4, 'contact mismatch fixture')`,
      [book1, contact2, owner1, cashEvent]
    ),
    /foreign key/i
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_events
      (id, book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id, reverses_event_id, reversal_reason)
     VALUES ($1, $2, $3, 'CUP', 'reversal', 2540, $4, $5, 'Partial correction fixture')`,
    [reversalEvent, book1, contact1, owner1, cashEvent]
  );
  await expectFailure(
    'a reversal cannot reverse another reversal',
    () => db.query(
      `INSERT INTO fortuna_private.financial_events
        (book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id, reverses_event_id, reversal_reason)
       VALUES ($1, $2, 'CUP', 'reversal', 100, $3, $4, 'invalid second reversal fixture')`,
      [book1, contact1, owner1, reversalEvent]
    ),
    /fortuna_invalid_reversal_target/i
  );
  await expectFailure(
    'reversal must provide a non-empty reason',
    () => db.query(
      `INSERT INTO fortuna_private.financial_events
        (book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id, reverses_event_id)
       VALUES ($1, $2, 'CUP', 'reversal', 100, $3, $4)`,
      [book1, contact1, owner1, cashEvent]
    ),
    /check constraint/i
  );
  await expectFailure(
    'event cannot reverse itself',
    () => db.query(
      `INSERT INTO fortuna_private.financial_events
        (id, book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id, reverses_event_id, reversal_reason)
       VALUES ($1, $2, $3, 'CUP', 'reversal', 100, $4, $1, 'self reversal fixture')`,
      [selfReversalEvent, book1, contact1, owner1]
    ),
    /check constraint/i
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_ledger_entries
      (book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor)
     VALUES ($1, $2, $3, 'CUP', $4, 'reversal', 2540)`,
    [book1, reversalEvent, contact1, obligation1]
  );
  console.log('PASS — reversal stays within the original contact/currency and cannot reverse a reversal');

  await expectFailure(
    'ledger entry cannot cross currencies',
    () => db.query(
      `INSERT INTO fortuna_private.financial_ledger_entries
        (book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor)
       VALUES ($1, $2, $3, 'USD', $4, 'cash_received', -100)`,
      [book1, cashEvent, contact1, obligation1]
    ),
    /foreign key/i
  );

  await expectFailure(
    'ledger entry cannot cross contacts',
    () => db.query(
      `INSERT INTO fortuna_private.financial_ledger_entries
        (book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor)
       VALUES ($1, $2, $3, 'CUP', $4, 'cash_received', -100)`,
      [book1, cashEvent, contact2, obligation1]
    ),
    /foreign key/i
  );

  await expectFailure(
    'ledger entry cannot cross books',
    () => db.query(
      `INSERT INTO fortuna_private.financial_ledger_entries
        (book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor)
       VALUES ($1, $2, $3, 'CUP', $4, 'cash_received', -100)`,
      [book2, cashEvent, contact1, obligation1]
    ),
    /foreign key/i
  );

  const key = 'fortuna-test-key-0001';
  const payloadHash = 'a'.repeat(64);
  await db.query(
    `INSERT INTO fortuna_private.financial_idempotency
      (book_id, actor_user_id, idempotency_key, payload_sha256)
     VALUES ($1, $2, $3, $4)`,
    [book1, owner1, key, payloadHash]
  );
  await expectFailure(
    'same actor cannot reuse an idempotency key within the book',
    () => db.query(
      `INSERT INTO fortuna_private.financial_idempotency
        (book_id, actor_user_id, idempotency_key, payload_sha256)
       VALUES ($1, $2, $3, $4)`,
      [book1, owner1, key, 'b'.repeat(64)]
    ),
    /unique/i
  );
  await db.query(
    `UPDATE fortuna_private.financial_idempotency
        SET status = 'committed', event_id = $1, committed_at = now(),
            response = '{"accepted":true}'::jsonb
      WHERE book_id = $2 AND actor_user_id = $3 AND idempotency_key = $4`,
    [cashEvent, book1, owner1, key]
  );
  await expectFailure(
    'processing idempotency row cannot contain a result',
    () => db.query(
      `INSERT INTO fortuna_private.financial_idempotency
        (book_id, actor_user_id, idempotency_key, payload_sha256, event_id)
       VALUES ($1, $2, 'fortuna-test-key-0003', $3, $4)`,
      [book1, owner1, payloadHash, cashEvent]
    ),
    /check constraint/i
  );
  await expectFailure(
    'idempotency row cannot be created directly as committed',
    () => db.query(
      `INSERT INTO fortuna_private.financial_idempotency
        (book_id, actor_user_id, idempotency_key, payload_sha256, status, event_id, response, committed_at)
       VALUES ($1, $2, 'fortuna-test-key-0002', $3, 'committed', $4, '{}'::jsonb, now())`,
      [book1, owner1, payloadHash, cashEvent]
    ),
    /fortuna_idempotency_initial_state_invalid/i
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_idempotency
      (book_id, actor_user_id, idempotency_key, payload_sha256)
     VALUES ($1, $2, $3, $4)`,
    [book1, owner2, key, payloadHash]
  );
  await expectFailure(
    'idempotency key is scoped to the actor within the book',
    () => db.query(
      `INSERT INTO fortuna_private.financial_idempotency
        (book_id, actor_user_id, idempotency_key, payload_sha256)
       VALUES ($1, $2, $3, $4)`,
      [book1, owner1, key, payloadHash]
    ),
    /unique/i
  );
  await expectFailure(
    'idempotency payload hash cannot be rewritten after insert',
    () => db.query(
      `UPDATE fortuna_private.financial_idempotency
          SET payload_sha256 = $1
        WHERE book_id = $2 AND actor_user_id = $3 AND idempotency_key = $4`,
      ['b'.repeat(64), book1, owner1, key]
    ),
    /fortuna_idempotency_identity_immutable/i
  );
  await expectFailure(
    'committed idempotency result is immutable',
    () => db.query(
      `UPDATE fortuna_private.financial_idempotency
          SET response = '{"accepted":false}'::jsonb
        WHERE book_id = $1 AND actor_user_id = $2 AND idempotency_key = $3`,
      [book1, owner1, key]
    ),
    /fortuna_idempotency_committed_immutable/i
  );

  await db.query(
    `INSERT INTO fortuna_private.financial_audit (book_id, event_id, actor_user_id, action)
     VALUES ($1, $2, $3, 'cash_received_fixture')`,
    [book1, cashEvent, owner1]
  );

  await expectFailure(
    'financial events are append-only',
    () => db.query(
      `UPDATE fortuna_private.financial_events SET metadata = '{"tampered":true}'::jsonb WHERE id = $1`,
      [cashEvent]
    ),
    /immutable_record/i
  );
  await expectFailure(
    'ledger entries are append-only',
    () => db.query(
      `DELETE FROM fortuna_private.financial_ledger_entries WHERE event_id = $1`,
      [cashEvent]
    ),
    /immutable_record/i
  );
  await expectFailure(
    'audit rows are append-only',
    () => db.query(
      `UPDATE fortuna_private.financial_audit SET action = 'tampered' WHERE event_id = $1`,
      [cashEvent]
    ),
    /immutable_record/i
  );

  await db.exec('BEGIN');
  await db.query(
    `INSERT INTO fortuna_private.financial_contacts (book_id, display_name)
     VALUES ($1, 'Rollback fixture')`,
    [book1]
  );
  await db.exec('ROLLBACK');
  const rolledBack = await scalar(
    `SELECT count(*)::int AS value FROM fortuna_private.financial_contacts
      WHERE display_name = 'Rollback fixture'`
  );
  assert.equal(Number(rolledBack), 0);
  console.log('PASS — transaction rollback leaves no partial contact record');

  const auditCount = await scalar('SELECT count(*)::int AS value FROM fortuna_private.financial_audit');
  assert.equal(Number(auditCount), 1);
  console.log('PASS — audit record is stored separately from financial ledger entries');

  console.log('PASS — isolated FORTUNA PostgreSQL schema verification complete');
} finally {
  await db.close();
}
