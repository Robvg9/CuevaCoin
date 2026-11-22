-- FORTUNA API/private schema boundary prototype for isolated tests ONLY.
-- NOT a migration. Do not expose fortuna_private through the Supabase Data API.
-- Candidate topology:
--   Data API exposes schema "api" only.
--   api wrappers are SECURITY INVOKER and accept no actor/owner identity.
--   wrappers delegate to a private SECURITY DEFINER helper that derives auth.uid().
--   authenticated receives schema USAGE + EXECUTE only, no table privileges.

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $fortuna_api_auth$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fortuna_api_auth$;

GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE SCHEMA api;
REVOKE ALL ON SCHEMA api FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA api TO authenticated;

-- The schema remains unexposed; USAGE is only needed by a caller invoking the
-- SECURITY INVOKER wrapper, which resolves this one approved helper.
GRANT USAGE ON SCHEMA fortuna_private TO authenticated;

CREATE OR REPLACE FUNCTION fortuna_private.test_fortuna_current_book_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_private_api$
DECLARE
  v_actor uuid;
  v_book uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;

  SELECT b.id
    INTO v_book
    FROM fortuna_private.financial_books AS b
   WHERE b.owner_user_id = v_actor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fortuna_book_not_found';
  END IF;

  RETURN v_book;
END;
$fortuna_private_api$;

REVOKE ALL ON FUNCTION fortuna_private.test_fortuna_current_book_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fortuna_private.test_fortuna_current_book_id() TO authenticated;

-- Exposed RPC surface: caller identity is never a function argument.
CREATE OR REPLACE FUNCTION api.test_fortuna_my_book_id()
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_wrapper$
  SELECT fortuna_private.test_fortuna_current_book_id();
$fortuna_api_wrapper$;

REVOKE ALL ON FUNCTION api.test_fortuna_my_book_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api.test_fortuna_my_book_id() TO authenticated;

-- Deliberately no GRANT on any table in fortuna_private to authenticated/anon.
