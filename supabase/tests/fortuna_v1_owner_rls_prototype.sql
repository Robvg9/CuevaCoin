-- FORTUNA v1 owner-isolation policy overlay for isolated tests ONLY.
-- This is NOT a migration and MUST NOT be applied to CuevaCoin LIVE.
-- The fixture temporarily grants authenticated schema access so that RLS can be
-- exercised directly. Production must keep fortuna_private unexposed and must
-- not copy these test grants without a separately approved API design.

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $fortuna_test_auth$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  );
$fortuna_test_auth$;

GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

-- A narrow boolean helper is needed because child-table policies must validate
-- their parent book. It accepts no caller-supplied owner ID; identity comes from
-- auth.uid() in the request claim context. The production function, if adopted,
-- must remain in a private schema with a fixed search_path and restricted EXECUTE.
CREATE OR REPLACE FUNCTION fortuna_private.test_is_book_owner(p_book_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_test_owner$
  SELECT EXISTS (
    SELECT 1
      FROM fortuna_private.financial_books AS b
     WHERE b.id = p_book_id
       AND b.owner_user_id = (SELECT auth.uid())
  );
$fortuna_test_owner$;

REVOKE ALL ON FUNCTION fortuna_private.test_is_book_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fortuna_private.test_is_book_owner(uuid) TO authenticated;

-- Owner controls the single book row. Both USING and WITH CHECK are required
-- so an owner cannot reassign the resulting row to another user.
CREATE POLICY financial_books_owner_select
  ON fortuna_private.financial_books
  FOR SELECT TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));

CREATE POLICY financial_books_owner_insert
  ON fortuna_private.financial_books
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = (SELECT auth.uid()));

CREATE POLICY financial_books_owner_update
  ON fortuna_private.financial_books
  FOR UPDATE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (owner_user_id = (SELECT auth.uid()));

-- Every child record is scoped through its owning financial book.
CREATE POLICY financial_contacts_owner_access
  ON fortuna_private.financial_contacts
  FOR ALL TO authenticated
  USING (fortuna_private.test_is_book_owner(book_id))
  WITH CHECK (fortuna_private.test_is_book_owner(book_id));

CREATE POLICY financial_obligations_owner_access
  ON fortuna_private.financial_obligations
  FOR ALL TO authenticated
  USING (fortuna_private.test_is_book_owner(book_id))
  WITH CHECK (fortuna_private.test_is_book_owner(book_id));

CREATE POLICY financial_events_owner_access
  ON fortuna_private.financial_events
  FOR ALL TO authenticated
  USING (fortuna_private.test_is_book_owner(book_id))
  WITH CHECK (fortuna_private.test_is_book_owner(book_id));

CREATE POLICY financial_ledger_owner_access
  ON fortuna_private.financial_ledger_entries
  FOR ALL TO authenticated
  USING (fortuna_private.test_is_book_owner(book_id))
  WITH CHECK (fortuna_private.test_is_book_owner(book_id));

CREATE POLICY financial_allocations_owner_access
  ON fortuna_private.financial_allocations
  FOR ALL TO authenticated
  USING (fortuna_private.test_is_book_owner(book_id))
  WITH CHECK (fortuna_private.test_is_book_owner(book_id));

CREATE POLICY financial_idempotency_owner_access
  ON fortuna_private.financial_idempotency
  FOR ALL TO authenticated
  USING (fortuna_private.test_is_book_owner(book_id))
  WITH CHECK (fortuna_private.test_is_book_owner(book_id));

CREATE POLICY financial_audit_owner_access
  ON fortuna_private.financial_audit
  FOR ALL TO authenticated
  USING (fortuna_private.test_is_book_owner(book_id))
  WITH CHECK (fortuna_private.test_is_book_owner(book_id));

-- Currencies are a shared, read-only catalogue, not personal-book data.
CREATE POLICY financial_currencies_authenticated_read
  ON fortuna_private.financial_currencies
  FOR SELECT TO authenticated
  USING (is_active);

-- Test-only grants: expose enough to the authenticated role to exercise the
-- policies. Financial events/ledger/allocations/idempotency/audit remain read-only.
GRANT USAGE ON SCHEMA fortuna_private TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA fortuna_private TO authenticated;
GRANT INSERT ON fortuna_private.financial_books TO authenticated;
GRANT UPDATE (owner_user_id) ON fortuna_private.financial_books TO authenticated;
GRANT INSERT ON fortuna_private.financial_contacts TO authenticated;
GRANT UPDATE (display_name, book_id) ON fortuna_private.financial_contacts TO authenticated;
