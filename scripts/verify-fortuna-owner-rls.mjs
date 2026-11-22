import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const schemaPath = process.env.FORTUNA_SQL_FILE;
const rlsPath = process.env.FORTUNA_RLS_SQL_FILE;
if (!schemaPath) throw new Error('FORTUNA_SQL_FILE must point to the isolated schema prototype');
if (!rlsPath) throw new Error('FORTUNA_RLS_SQL_FILE must point to the isolated owner-RLS overlay');

const [schemaSql, rlsSql] = await Promise.all([
  readFile(schemaPath, 'utf8'),
  readFile(rlsPath, 'utf8'),
]);
const db = new PGlite();

const ids = {
  owner1: '10000000-0000-4000-8000-000000000001',
  owner2: '10000000-0000-4000-8000-000000000002',
  owner3: '10000000-0000-4000-8000-000000000003',
  book1: '20000000-0000-4000-8000-000000000001',
  book2: '20000000-0000-4000-8000-000000000002',
  contact1: '30000000-0000-4000-8000-000000000001',
  contact2: '30000000-0000-4000-8000-000000000002',
  obligation1: '40000000-0000-4000-8000-000000000001',
  obligation2: '40000000-0000-4000-8000-000000000002',
  event1: '50000000-0000-4000-8000-000000000001',
  event2: '50000000-0000-4000-8000-000000000002',
};

const childTables = [
  'financial_contacts',
  'financial_obligations',
  'financial_events',
  'financial_ledger_entries',
  'financial_allocations',
  'financial_idempotency',
  'financial_audit',
];

async function count(table) {
  const result = await db.query(`SELECT count(*)::int AS count FROM fortuna_private.${table}`);
  return Number(result.rows[0].count);
}

async function expectFailure(label, operation, pattern = /row.level security|permission denied|insufficient privilege/i) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, label + ': expected the operation to fail');
  assert.match(String(caught.message || caught), pattern, label);
  console.log('PASS — ' + label);
}

async function authenticateAs(userId) {
  await db.exec('RESET ROLE; SET ROLE authenticated;');
  // This GUC is set by PostgREST after Supabase validates a JWT. Setting it
  // manually here tests policy behavior only; it does NOT verify JWT signatures.
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

try {
  const version = await db.query('SELECT version() AS version');
  assert.match(version.rows[0].version, /PostgreSQL 17/i);
  console.log('PASS — isolated RLS engine: ' + version.rows[0].version);

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

  // Verify the base schema is closed before applying the test-only RLS overlay.
  const baseline = await db.query(`
    SELECT
      has_schema_privilege('anon', 'fortuna_private', 'USAGE') AS anon_usage,
      has_schema_privilege('authenticated', 'fortuna_private', 'USAGE') AS auth_usage,
      has_table_privilege('anon', 'fortuna_private.financial_books', 'SELECT') AS anon_select,
      has_table_privilege('authenticated', 'fortuna_private.financial_books', 'SELECT') AS auth_select
  `);
  assert.deepEqual(baseline.rows[0], {
    anon_usage: false,
    auth_usage: false,
    anon_select: false,
    auth_select: false,
  });
  console.log('PASS — production-shaped baseline denies anon/authenticated direct schema access');

  await db.exec(rlsSql);
  console.log('PASS — isolated owner-only RLS policies and test grants loaded');

  await db.query(
    'INSERT INTO auth.users (id) VALUES ($1), ($2), ($3)',
    [ids.owner1, ids.owner2, ids.owner3]
  );
  await db.query(
    'INSERT INTO public.cuevacoin_global_admin_fixture (user_id, is_global_admin) VALUES ($1, true)',
    [ids.owner2]
  );
  await db.query(
    "INSERT INTO fortuna_private.financial_currencies (code, display_name, minor_unit_scale) VALUES ('CUP', 'Cuban Peso fixture', 2)"
  );
  await db.query(
    'INSERT INTO fortuna_private.financial_books (id, owner_user_id) VALUES ($1, $2), ($3, $4)',
    [ids.book1, ids.owner1, ids.book2, ids.owner2]
  );
  await db.query(
    'INSERT INTO fortuna_private.financial_contacts (id, book_id, display_name) VALUES ($1, $2, $3), ($4, $5, $6)',
    [ids.contact1, ids.book1, 'Owner One contact', ids.contact2, ids.book2, 'Owner Two contact']
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_obligations
      (id, book_id, contact_id, currency_code, direction, principal_minor, description, created_by)
     VALUES ($1, $2, $3, 'CUP', 'receivable', 1000, 'Owner One obligation', $4),
            ($5, $6, $7, 'CUP', 'receivable', 2000, 'Owner Two obligation', $8)`,
    [ids.obligation1, ids.book1, ids.contact1, ids.owner1, ids.obligation2, ids.book2, ids.contact2, ids.owner2]
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_events
      (id, book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id)
     VALUES ($1, $2, $3, 'CUP', 'obligation_opened', 1000, $4),
            ($5, $6, $7, 'CUP', 'obligation_opened', 2000, $8)`,
    [ids.event1, ids.book1, ids.contact1, ids.owner1, ids.event2, ids.book2, ids.contact2, ids.owner2]
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_ledger_entries
      (book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor)
     VALUES ($1, $2, $3, 'CUP', $4, 'obligation_opened', 1000),
            ($5, $6, $7, 'CUP', $8, 'obligation_opened', 2000)`,
    [ids.book1, ids.event1, ids.contact1, ids.obligation1, ids.book2, ids.event2, ids.contact2, ids.obligation2]
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_allocations
      (book_id, event_id, obligation_id, contact_id, currency_code, amount_minor)
     VALUES ($1, $2, $3, $4, 'CUP', 100),
            ($5, $6, $7, $8, 'CUP', 200)`,
    [ids.book1, ids.event1, ids.obligation1, ids.contact1, ids.book2, ids.event2, ids.obligation2, ids.contact2]
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_idempotency
      (book_id, actor_user_id, idempotency_key, payload_sha256)
     VALUES ($1, $2, 'owner-one-key', $3),
            ($4, $5, 'owner-two-key', $6)`,
    [ids.book1, ids.owner1, 'a'.repeat(64), ids.book2, ids.owner2, 'b'.repeat(64)]
  );
  await db.query(
    `INSERT INTO fortuna_private.financial_audit
      (book_id, event_id, actor_user_id, action)
     VALUES ($1, $2, $3, 'owner_one_fixture'),
            ($4, $5, $6, 'owner_two_fixture')`,
    [ids.book1, ids.event1, ids.owner1, ids.book2, ids.event2, ids.owner2]
  );
  console.log('PASS — two isolated owners and one global-admin fixture seeded');

  await authenticateAs(ids.owner1);
  assert.equal(await count('financial_books'), 1);
  assert.equal(await count('financial_contacts'), 1);
  assert.equal(await count('financial_obligations'), 1);
  assert.equal(await count('financial_events'), 1);
  assert.equal(await count('financial_ledger_entries'), 1);
  assert.equal(await count('financial_allocations'), 1);
  assert.equal(await count('financial_idempotency'), 1);
  assert.equal(await count('financial_audit'), 1);
  assert.equal(await count('financial_currencies'), 1);
  console.log('PASS — owner one sees only its own book and every book-scoped table');

  const ownContactUpdate = await db.query(
    'UPDATE fortuna_private.financial_contacts SET display_name = $1 WHERE id = $2 RETURNING id',
    ['Owner One renamed', ids.contact1]
  );
  assert.equal(ownContactUpdate.rows.length, 1, 'owner can update its own contact');
  const crossContactUpdate = await db.query(
    'UPDATE fortuna_private.financial_contacts SET display_name = $1 WHERE id = $2 RETURNING id',
    ['CROSS-BOOK WRITE MUST NOT HAPPEN', ids.contact2]
  );
  assert.equal(crossContactUpdate.rows.length, 0, 'foreign row is invisible to UPDATE USING policy');

  await expectFailure(
    'owner cannot insert a contact into another owner book',
    () => db.query(
      'INSERT INTO fortuna_private.financial_contacts (book_id, display_name) VALUES ($1, $2) RETURNING id',
      [ids.book2, 'forbidden cross-book contact']
    )
  );
  await expectFailure(
    'owner cannot reassign its own book to another user',
    () => db.query(
      'UPDATE fortuna_private.financial_books SET owner_user_id = $1 WHERE id = $2 RETURNING id',
      [ids.owner3, ids.book1]
    )
  );
  await expectFailure(
    'owner cannot create a book under another user identity',
    () => db.query(
      'INSERT INTO fortuna_private.financial_books (owner_user_id) VALUES ($1) RETURNING id',
      [ids.owner2]
    )
  );

  await expectFailure(
    'one owner cannot create a second book',
    () => db.query(
      'INSERT INTO fortuna_private.financial_books (owner_user_id) VALUES ($1) RETURNING id',
      [ids.owner1]
    ),
    /unique/i
  );

  await authenticateAs(ids.owner2);
  const globalAdminCheck = await db.query(
    'SELECT is_global_admin FROM public.cuevacoin_global_admin_fixture WHERE user_id = $1',
    [ids.owner2]
  ).catch(() => ({ rows: [] }));
  // The role's global-admin marker is deliberately outside all FORTUNA policies.
  assert.equal(globalAdminCheck.rows.length, 0, 'authenticated role is not granted the unrelated global-admin fixture table');
  assert.equal(await count('financial_books'), 1);
  assert.equal(await count('financial_contacts'), 1);
  assert.equal(await count('financial_obligations'), 1);
  assert.equal(await count('financial_events'), 1);
  assert.equal(await count('financial_ledger_entries'), 1);
  assert.equal(await count('financial_allocations'), 1);
  assert.equal(await count('financial_idempotency'), 1);
  assert.equal(await count('financial_audit'), 1);
  const visibleBook = await db.query('SELECT id FROM fortuna_private.financial_books');
  assert.equal(visibleBook.rows[0].id, ids.book2);
  const protectedContact = await db.query(
    'SELECT display_name FROM fortuna_private.financial_contacts WHERE id = $1',
    [ids.contact1]
  );
  assert.equal(protectedContact.rows.length, 0);
  console.log('PASS — CuevaCoin global-admin marker grants no access to another personal book');

  await db.exec('RESET ROLE; SET ROLE anon;');
  await expectFailure(
    'anon cannot access the private FORTUNA schema',
    () => db.query('SELECT * FROM fortuna_private.financial_books')
  );

  await db.exec('RESET ROLE; SET ROLE service_role;');
  assert.equal(await count('financial_books'), 2);
  assert.equal(await count('financial_contacts'), 2);
  console.log('PASS — service_role bypasses RLS as expected; it must remain server-only');

  const bookOneOwner = await db.query(
    'SELECT owner_user_id FROM fortuna_private.financial_books WHERE id = $1',
    [ids.book1]
  );
  assert.equal(bookOneOwner.rows[0].owner_user_id, ids.owner1);

  console.log('PASS — all FORTUNA owner-isolation and RLS assertions verified');
} finally {
  await db.close();
}
