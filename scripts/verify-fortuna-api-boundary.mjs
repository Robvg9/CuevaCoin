import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const schemaPath = process.env.FORTUNA_SQL_FILE;
const apiPath = process.env.FORTUNA_API_BOUNDARY_SQL_FILE;
if (!schemaPath) throw new Error('FORTUNA_SQL_FILE must point to the isolated schema prototype');
if (!apiPath) throw new Error('FORTUNA_API_BOUNDARY_SQL_FILE must point to the isolated API/private boundary prototype');

const [schemaSql, apiSql] = await Promise.all([
  readFile(schemaPath, 'utf8'),
  readFile(apiPath, 'utf8'),
]);
const db = new PGlite();

const ids = {
  owner1: '10000000-0000-4000-8000-000000000001',
  owner2: '10000000-0000-4000-8000-000000000002',
  book1: '20000000-0000-4000-8000-000000000001',
  book2: '20000000-0000-4000-8000-000000000002',
};

async function expectFailure(label, operation, pattern = /permission denied|fortuna_auth_required|row.level security/i) {
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
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function myBookId() {
  const result = await db.query('SELECT api.test_fortuna_my_book_id() AS book_id');
  return result.rows[0].book_id;
}

try {
  const version = await db.query('SELECT version() AS version');
  assert.match(version.rows[0].version, /PostgreSQL 17/i);
  console.log('PASS — isolated API boundary engine: ' + version.rows[0].version);

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
  await db.exec(apiSql);

  await db.query(
    'INSERT INTO auth.users (id) VALUES ($1), ($2)',
    [ids.owner1, ids.owner2]
  );
  await db.query(
    'INSERT INTO public.cuevacoin_global_admin_fixture (user_id, is_global_admin) VALUES ($1, true)',
    [ids.owner2]
  );
  const adminFixture = await db.query(
    'SELECT is_global_admin FROM public.cuevacoin_global_admin_fixture WHERE user_id = $1',
    [ids.owner2]
  );
  assert.equal(adminFixture.rows[0].is_global_admin, true);
  await db.query(
    'INSERT INTO fortuna_private.financial_books (id, owner_user_id) VALUES ($1, $2), ($3, $4)',
    [ids.book1, ids.owner1, ids.book2, ids.owner2]
  );
  console.log('PASS — two owners seeded; second owner is a global CuevaCoin admin fixture');

  const grants = await db.query(`
    SELECT
      has_schema_privilege('anon', 'api', 'USAGE') AS anon_api_usage,
      has_schema_privilege('authenticated', 'api', 'USAGE') AS authenticated_api_usage,
      has_schema_privilege('authenticated', 'fortuna_private', 'USAGE') AS authenticated_private_usage,
      has_table_privilege('authenticated', 'fortuna_private.financial_books', 'SELECT') AS authenticated_book_select,
      has_table_privilege('authenticated', 'fortuna_private.financial_books', 'INSERT') AS authenticated_book_insert,
      has_table_privilege('authenticated', 'fortuna_private.financial_books', 'UPDATE') AS authenticated_book_update,
      has_function_privilege('anon', 'api.test_fortuna_my_book_id()', 'EXECUTE') AS anon_api_execute,
      has_function_privilege('authenticated', 'api.test_fortuna_my_book_id()', 'EXECUTE') AS authenticated_api_execute,
      has_function_privilege('anon', 'fortuna_private.test_fortuna_current_book_id()', 'EXECUTE') AS anon_private_execute,
      has_function_privilege('authenticated', 'fortuna_private.test_fortuna_current_book_id()', 'EXECUTE') AS authenticated_private_execute
  `);
  assert.deepEqual(grants.rows[0], {
    anon_api_usage: false,
    authenticated_api_usage: true,
    authenticated_private_usage: true,
    authenticated_book_select: false,
    authenticated_book_insert: false,
    authenticated_book_update: false,
    anon_api_execute: false,
    authenticated_api_execute: true,
    anon_private_execute: false,
    authenticated_private_execute: true,
  });
  console.log('PASS — authenticated has API/function access only; no direct private-table read/write grants');

  const functionSecurity = await db.query(`
    SELECT n.nspname, p.proname, p.prosecdef, p.pronargs, p.proconfig
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE (n.nspname = 'api' AND p.proname = 'test_fortuna_my_book_id')
        OR (n.nspname = 'fortuna_private' AND p.proname = 'test_fortuna_current_book_id')
     ORDER BY n.nspname
  `);
  assert.equal(functionSecurity.rows.length, 2);
  const apiFunction = functionSecurity.rows.find(row => row.nspname === 'api');
  const privateFunction = functionSecurity.rows.find(row => row.nspname === 'fortuna_private');
  assert.equal(apiFunction.prosecdef, false, 'API wrapper must be SECURITY INVOKER');
  assert.equal(apiFunction.pronargs, 0, 'API wrapper must not accept actor/owner ID parameters');
  assert.equal(privateFunction.prosecdef, true, 'private helper must be SECURITY DEFINER');
  assert.equal(privateFunction.pronargs, 0, 'private helper derives identity and accepts no caller ID');
  assert.ok(Array.isArray(privateFunction.proconfig));
  assert.ok(privateFunction.proconfig.includes('search_path=pg_catalog'));
  assert.ok(Array.isArray(apiFunction.proconfig));
  assert.ok(apiFunction.proconfig.includes('search_path=pg_catalog'));
  console.log('PASS — invoker API wrapper delegates to a private fixed-search_path SECURITY DEFINER helper with no identity arguments');

  await authenticateAs(ids.owner1);
  assert.equal(await myBookId(), ids.book1, 'owner one resolves only its own book');
  await expectFailure(
    'owner cannot query private book tables directly through its authenticated database role',
    () => db.query('SELECT id FROM fortuna_private.financial_books')
  );
  await expectFailure(
    'API wrapper does not accept a caller-supplied owner ID',
    () => db.query('SELECT api.test_fortuna_my_book_id($1::uuid)', [ids.owner2]),
    /function .* does not exist/i
  );
  console.log('PASS — owner one invokes the API boundary and receives only its own book ID');

  await authenticateAs(ids.owner2);
  assert.equal(await myBookId(), ids.book2, 'global admin resolves its own book, never another owner book');
  assert.notEqual(await myBookId(), ids.book1);
  console.log('PASS — CuevaCoin global-admin fixture remains confined to its own personal book');

  await db.exec('RESET ROLE; SET ROLE authenticated;');
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await expectFailure(
    'API rejects an authenticated database role without a verified subject claim',
    () => db.query('SELECT api.test_fortuna_my_book_id()'),
    /fortuna_auth_required/i
  );

  await db.exec('RESET ROLE; SET ROLE anon;');
  await expectFailure(
    'anon cannot reach the exposed API schema or invoke the wrapper',
    () => db.query('SELECT api.test_fortuna_my_book_id()')
  );

  await db.exec('RESET ROLE;');
  const directAccess = await db.query(`
    SELECT
      has_table_privilege('anon', 'fortuna_private.financial_books', 'SELECT') AS anon_select,
      has_table_privilege('authenticated', 'fortuna_private.financial_books', 'SELECT') AS authenticated_select,
      has_table_privilege('authenticated', 'fortuna_private.financial_contacts', 'INSERT') AS authenticated_contact_insert,
      (SELECT count(*)::int FROM fortuna_private.financial_books) AS book_count
  `);
  assert.deepEqual(directAccess.rows[0], {
    anon_select: false,
    authenticated_select: false,
    authenticated_contact_insert: false,
    book_count: 2,
  });
  console.log('PASS — API calls did not mutate or expose private tables; both books remain intact');
  console.log('PASS — all FORTUNA API/private boundary assertions verified');
} finally {
  await db.close();
}
