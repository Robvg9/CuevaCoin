-- FORTUNA owner-only API operations prototype for isolated tests ONLY.
-- NOT a migration. Do not apply this file to any hosted Supabase project.
-- The API wrappers are SECURITY INVOKER; private helpers are narrowly scoped
-- SECURITY DEFINER functions that derive identity from auth.uid().

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $fortuna_operations_auth$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fortuna_operations_auth$;

GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE SCHEMA IF NOT EXISTS api;
REVOKE ALL ON SCHEMA api FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA api TO authenticated;

-- The schema is not exposed by these tests; USAGE only lets the invoker
-- wrappers resolve their explicitly granted private helper functions.
GRANT USAGE ON SCHEMA fortuna_private TO authenticated;

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_get_current_book_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_get_book$
DECLARE
  v_actor uuid;
  v_book_id uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;

  SELECT b.id
    INTO v_book_id
    FROM fortuna_private.financial_books AS b
   WHERE b.owner_user_id = v_actor;

  RETURN v_book_id;
END;
$fortuna_get_book$;

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_ensure_current_book_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_ensure_book$
DECLARE
  v_actor uuid;
  v_book_id uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;

  INSERT INTO fortuna_private.financial_books (owner_user_id)
  VALUES (v_actor)
  ON CONFLICT (owner_user_id) DO NOTHING;

  SELECT b.id
    INTO v_book_id
    FROM fortuna_private.financial_books AS b
   WHERE b.owner_user_id = v_actor;

  IF v_book_id IS NULL THEN
    RAISE EXCEPTION 'fortuna_book_not_found';
  END IF;

  RETURN v_book_id;
END;
$fortuna_ensure_book$;

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_create_contact(
  p_display_name text,
  p_phone text,
  p_notes text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_create_contact$
DECLARE
  v_actor uuid;
  v_book_id uuid;
  v_display_name text;
  v_phone text;
  v_notes text;
  v_key text;
  v_payload jsonb;
  v_payload_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_response jsonb;
  v_contact_id uuid;
  v_response jsonb;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;

  v_display_name := pg_catalog.btrim(COALESCE(p_display_name, ''));
  v_phone := NULLIF(pg_catalog.btrim(COALESCE(p_phone, '')), '');
  v_notes := NULLIF(pg_catalog.btrim(COALESCE(p_notes, '')), '');
  v_key := pg_catalog.btrim(COALESCE(p_idempotency_key, ''));

  IF v_display_name = '' OR pg_catalog.length(v_display_name) > 120 THEN
    RAISE EXCEPTION 'fortuna_contact_name_invalid';
  END IF;
  IF v_phone IS NOT NULL AND pg_catalog.length(v_phone) > 40 THEN
    RAISE EXCEPTION 'fortuna_contact_phone_too_long';
  END IF;
  IF v_notes IS NOT NULL AND pg_catalog.length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'fortuna_contact_notes_too_long';
  END IF;
  IF pg_catalog.length(v_key) < 8 OR pg_catalog.length(v_key) > 200 THEN
    RAISE EXCEPTION 'fortuna_idempotency_key_invalid';
  END IF;

  v_book_id := fortuna_private.fortuna_ensure_current_book_id();

  v_payload := pg_catalog.jsonb_build_object(
    'version', 1,
    'command', 'create_contact',
    'display_name', v_display_name,
    'phone', v_phone,
    'notes', v_notes
  );
  v_payload_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_payload::text, 'UTF8')),
    'hex'
  );

  INSERT INTO fortuna_private.financial_idempotency (
    book_id, actor_user_id, idempotency_key, payload_sha256
  )
  VALUES (v_book_id, v_actor, v_key, v_payload_hash)
  ON CONFLICT (book_id, actor_user_id, idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT i.payload_sha256, i.status, i.response
      INTO v_existing_hash, v_existing_status, v_existing_response
      FROM fortuna_private.financial_idempotency AS i
     WHERE i.book_id = v_book_id
       AND i.actor_user_id = v_actor
       AND i.idempotency_key = v_key
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'fortuna_idempotency_reservation_missing';
    END IF;
    IF v_existing_hash <> v_payload_hash THEN
      RAISE EXCEPTION 'fortuna_idempotency_conflict';
    END IF;
    IF v_existing_status = 'committed' AND v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;
    RAISE EXCEPTION 'fortuna_idempotency_in_progress';
  END IF;

  INSERT INTO fortuna_private.financial_contacts (
    book_id, display_name, phone, notes
  )
  VALUES (v_book_id, v_display_name, v_phone, v_notes)
  RETURNING id INTO v_contact_id;

  INSERT INTO fortuna_private.financial_audit (
    book_id, event_id, actor_user_id, action, details
  )
  VALUES (
    v_book_id,
    NULL,
    v_actor,
    'contact_created',
    pg_catalog.jsonb_build_object('contact_id', v_contact_id)
  );

  v_response := pg_catalog.jsonb_build_object(
    'contact_id', v_contact_id,
    'display_name', v_display_name,
    'phone', v_phone,
    'notes', v_notes
  );

  UPDATE fortuna_private.financial_idempotency
     SET status = 'committed',
         response = v_response,
         committed_at = pg_catalog.now()
   WHERE book_id = v_book_id
     AND actor_user_id = v_actor
     AND idempotency_key = v_key
     AND status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fortuna_idempotency_commit_missing';
  END IF;

  RETURN v_response;
END;
$fortuna_create_contact$;

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_open_obligation(
  p_contact_id uuid,
  p_direction text,
  p_currency_code text,
  p_amount_minor text,
  p_description text,
  p_due_at timestamptz,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_open_obligation$
DECLARE
  v_actor uuid;
  v_book_id uuid;
  v_direction text;
  v_currency text;
  v_amount_minor bigint;
  v_description text;
  v_key text;
  v_payload jsonb;
  v_payload_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_response jsonb;
  v_event_id uuid;
  v_obligation_id uuid;
  v_signed_minor bigint;
  v_response jsonb;
  v_scale smallint;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;

  IF p_contact_id IS NULL THEN
    RAISE EXCEPTION 'fortuna_contact_not_found';
  END IF;

  v_direction := pg_catalog.btrim(COALESCE(p_direction, ''));
  v_currency := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency_code, '')));
  v_description := pg_catalog.btrim(COALESCE(p_description, ''));
  v_key := pg_catalog.btrim(COALESCE(p_idempotency_key, ''));

  IF v_direction NOT IN ('receivable', 'payable') THEN
    RAISE EXCEPTION 'fortuna_obligation_direction_invalid';
  END IF;
  IF v_currency NOT IN ('CUP', 'USD', 'EUR') THEN
    RAISE EXCEPTION 'fortuna_currency_not_supported';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor !~ '^[1-9][0-9]{0,18}$' THEN
    RAISE EXCEPTION 'fortuna_amount_minor_invalid';
  END IF;
  BEGIN
    v_amount_minor := p_amount_minor::bigint;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'fortuna_amount_minor_invalid';
  END;
  IF v_amount_minor <= 0 THEN
    RAISE EXCEPTION 'fortuna_amount_must_be_positive';
  END IF;
  IF v_description = '' OR pg_catalog.length(v_description) > 500 THEN
    RAISE EXCEPTION 'fortuna_obligation_description_invalid';
  END IF;
  IF pg_catalog.length(v_key) < 8 OR pg_catalog.length(v_key) > 200 THEN
    RAISE EXCEPTION 'fortuna_idempotency_key_invalid';
  END IF;

  SELECT c.minor_unit_scale
    INTO v_scale
    FROM fortuna_private.financial_currencies AS c
   WHERE c.code = v_currency
     AND c.is_active = true;

  IF NOT FOUND OR v_scale <> 2 THEN
    RAISE EXCEPTION 'fortuna_currency_configuration_invalid';
  END IF;

  v_book_id := fortuna_private.fortuna_ensure_current_book_id();

  -- Resource identifiers are selectors only: they must belong to this owner's book.
  PERFORM 1
    FROM fortuna_private.financial_contacts AS c
   WHERE c.id = p_contact_id
     AND c.book_id = v_book_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fortuna_contact_not_found';
  END IF;

  v_payload := pg_catalog.jsonb_build_object(
    'version', 1,
    'command', 'open_obligation',
    'contact_id', p_contact_id,
    'direction', v_direction,
    'currency', v_currency,
    'amount_minor', v_amount_minor::text,
    'description', v_description,
    'due_at', p_due_at
  );
  v_payload_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_payload::text, 'UTF8')),
    'hex'
  );

  INSERT INTO fortuna_private.financial_idempotency (
    book_id, actor_user_id, idempotency_key, payload_sha256
  )
  VALUES (v_book_id, v_actor, v_key, v_payload_hash)
  ON CONFLICT (book_id, actor_user_id, idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT i.payload_sha256, i.status, i.response
      INTO v_existing_hash, v_existing_status, v_existing_response
      FROM fortuna_private.financial_idempotency AS i
     WHERE i.book_id = v_book_id
       AND i.actor_user_id = v_actor
       AND i.idempotency_key = v_key
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'fortuna_idempotency_reservation_missing';
    END IF;
    IF v_existing_hash <> v_payload_hash THEN
      RAISE EXCEPTION 'fortuna_idempotency_conflict';
    END IF;
    IF v_existing_status = 'committed' AND v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;
    RAISE EXCEPTION 'fortuna_idempotency_in_progress';
  END IF;

  INSERT INTO fortuna_private.financial_events (
    book_id, contact_id, currency_code, event_type,
    total_amount_minor, actor_user_id, occurred_at
  )
  VALUES (
    v_book_id, p_contact_id, v_currency, 'obligation_opened',
    v_amount_minor, v_actor, pg_catalog.now()
  )
  RETURNING id INTO v_event_id;

  INSERT INTO fortuna_private.financial_obligations (
    book_id, contact_id, currency_code, direction, principal_minor,
    description, due_at, created_by
  )
  VALUES (
    v_book_id, p_contact_id, v_currency, v_direction, v_amount_minor,
    v_description, p_due_at, v_actor
  )
  RETURNING id INTO v_obligation_id;

  v_signed_minor := CASE WHEN v_direction = 'receivable'
                         THEN v_amount_minor
                         ELSE -v_amount_minor END;

  INSERT INTO fortuna_private.financial_ledger_entries (
    book_id, event_id, contact_id, currency_code, obligation_id,
    entry_kind, signed_minor
  )
  VALUES (
    v_book_id, v_event_id, p_contact_id, v_currency, v_obligation_id,
    'obligation_opened', v_signed_minor
  );

  INSERT INTO fortuna_private.financial_audit (
    book_id, event_id, actor_user_id, action, details
  )
  VALUES (
    v_book_id,
    v_event_id,
    v_actor,
    'obligation_opened',
    pg_catalog.jsonb_build_object(
      'obligation_id', v_obligation_id,
      'contact_id', p_contact_id,
      'currency', v_currency,
      'direction', v_direction,
      'amount_minor', v_amount_minor::text
    )
  );

  v_response := pg_catalog.jsonb_build_object(
    'event_id', v_event_id,
    'obligation_id', v_obligation_id,
    'contact_id', p_contact_id,
    'direction', v_direction,
    'currency', v_currency,
    'amount_minor', v_amount_minor::text,
    'signed_minor', v_signed_minor::text
  );

  UPDATE fortuna_private.financial_idempotency
     SET status = 'committed',
         event_id = v_event_id,
         response = v_response,
         committed_at = pg_catalog.now()
   WHERE book_id = v_book_id
     AND actor_user_id = v_actor
     AND idempotency_key = v_key
     AND status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fortuna_idempotency_commit_missing';
  END IF;

  RETURN v_response;
END;
$fortuna_open_obligation$;

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_list_contacts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_list_contacts$
DECLARE
  v_book_id uuid;
  v_response jsonb;
BEGIN
  v_book_id := fortuna_private.fortuna_get_current_book_id();
  IF v_book_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH obligation_balances AS (
    SELECT
      o.id AS obligation_id,
      o.contact_id,
      o.currency_code,
      o.direction,
      COALESCE(pg_catalog.sum(l.signed_minor), 0)::bigint AS signed_minor
    FROM fortuna_private.financial_obligations AS o
    LEFT JOIN fortuna_private.financial_ledger_entries AS l
      ON l.book_id = o.book_id
     AND l.obligation_id = o.id
    WHERE o.book_id = v_book_id
    GROUP BY o.id, o.contact_id, o.currency_code, o.direction
  ),
  positions AS (
    SELECT
      b.contact_id,
      b.currency_code,
      pg_catalog.sum(
        CASE WHEN b.direction = 'receivable' THEN b.signed_minor ELSE 0 END
      )::bigint AS gross_receivable_minor,
      pg_catalog.sum(
        CASE WHEN b.direction = 'payable' THEN -b.signed_minor ELSE 0 END
      )::bigint AS gross_payable_minor
    FROM obligation_balances AS b
    GROUP BY b.contact_id, b.currency_code
    HAVING pg_catalog.sum(
             CASE WHEN b.direction = 'receivable' THEN b.signed_minor ELSE 0 END
           ) > 0
        OR pg_catalog.sum(
             CASE WHEN b.direction = 'payable' THEN -b.signed_minor ELSE 0 END
           ) > 0
  )
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'contact_id', c.id,
        'display_name', c.display_name,
        'phone', c.phone,
        'notes', c.notes,
        'currencies',
        COALESCE(
          (
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'currency', p.currency_code,
                'te_debe_minor', p.gross_receivable_minor::text,
                'le_debes_minor', p.gross_payable_minor::text,
                'position_type',
                  CASE
                    WHEN p.gross_receivable_minor > 0 AND p.gross_payable_minor > 0 THEN 'mixed'
                    WHEN p.gross_receivable_minor > 0 THEN 'receivable'
                    ELSE 'payable'
                  END
              )
              ORDER BY p.currency_code
            )
            FROM positions AS p
            WHERE p.contact_id = c.id
          ),
          '[]'::jsonb
        )
      )
      ORDER BY pg_catalog.lower(c.display_name), c.id
    ),
    '[]'::jsonb
  )
    INTO v_response
    FROM fortuna_private.financial_contacts AS c
   WHERE c.book_id = v_book_id;

  RETURN v_response;
END;
$fortuna_list_contacts$;


CREATE OR REPLACE FUNCTION fortuna_private.fortuna_list_obligations(
  p_contact_id uuid,
  p_currency_code text DEFAULT NULL,
  p_direction text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_list_obligations$
DECLARE
  v_book_id uuid;
  v_currency text;
  v_direction text;
  v_response jsonb;
BEGIN
  v_book_id := fortuna_private.fortuna_get_current_book_id();
  IF v_book_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p_contact_id IS NULL THEN
    RAISE EXCEPTION 'fortuna_contact_not_found';
  END IF;
  v_currency := NULLIF(pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency_code, ''))), '');
  v_direction := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_direction, ''))), '');
  IF v_direction IS NOT NULL AND v_direction NOT IN ('receivable', 'payable') THEN
    RAISE EXCEPTION 'fortuna_obligation_direction_invalid';
  END IF;
  IF v_currency IS NOT NULL AND v_currency NOT IN ('CUP', 'USD', 'EUR') THEN
    RAISE EXCEPTION 'fortuna_currency_not_supported';
  END IF;

  -- Contact ID is only a selector. The book predicate prevents cross-owner enumeration.
  PERFORM 1
    FROM fortuna_private.financial_contacts AS c
   WHERE c.id = p_contact_id
     AND c.book_id = v_book_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fortuna_contact_not_found';
  END IF;

  WITH balances AS (
    SELECT
      o.id,
      o.contact_id,
      o.currency_code,
      o.direction,
      o.principal_minor,
      o.description,
      o.due_at,
      o.created_at,
      COALESCE(pg_catalog.sum(l.signed_minor), 0)::bigint AS signed_minor
    FROM fortuna_private.financial_obligations AS o
    LEFT JOIN fortuna_private.financial_ledger_entries AS l
      ON l.book_id = o.book_id
     AND l.obligation_id = o.id
    WHERE o.book_id = v_book_id
      AND o.contact_id = p_contact_id
      AND (v_currency IS NULL OR o.currency_code = v_currency)
      AND (v_direction IS NULL OR o.direction = v_direction)
    GROUP BY o.id, o.contact_id, o.currency_code, o.direction,
             o.principal_minor, o.description, o.due_at, o.created_at
  )
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'obligation_id', b.id,
        'contact_id', b.contact_id,
        'currency', b.currency_code,
        'direction', b.direction,
        'principal_minor', b.principal_minor::text,
        'remaining_minor', CASE
          WHEN b.direction = 'receivable' THEN b.signed_minor::text
          ELSE (-b.signed_minor)::text
        END,
        'description', b.description,
        'due_at', b.due_at,
        'created_at', b.created_at
      )
      ORDER BY b.created_at, b.id
    ),
    '[]'::jsonb
  )
  INTO v_response
  FROM balances AS b
  WHERE CASE WHEN b.direction = 'receivable'
             THEN b.signed_minor ELSE -b.signed_minor END > 0;

  RETURN v_response;
END;
$fortuna_list_obligations$;

-- Narrow PostgREST RPC wrappers. No wrapper accepts book, actor, or owner IDs.
CREATE OR REPLACE FUNCTION api.create_contact(
  p_display_name text,
  p_phone text,
  p_notes text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_create_contact$
  SELECT fortuna_private.fortuna_create_contact($1, $2, $3, $4);
$fortuna_api_create_contact$;

CREATE OR REPLACE FUNCTION api.open_obligation(
  p_contact_id uuid,
  p_direction text,
  p_currency_code text,
  p_amount_minor text,
  p_description text,
  p_due_at timestamptz,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_open_obligation$
  SELECT fortuna_private.fortuna_open_obligation($1, $2, $3, $4, $5, $6, $7);
$fortuna_api_open_obligation$;

CREATE OR REPLACE FUNCTION api.list_contacts()
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_list_contacts$
  SELECT fortuna_private.fortuna_list_contacts();
$fortuna_api_list_contacts$;


CREATE OR REPLACE FUNCTION api.list_obligations(
  p_contact_id uuid,
  p_currency_code text DEFAULT NULL,
  p_direction text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_list_obligations$
  SELECT fortuna_private.fortuna_list_obligations($1, $2, $3);
$fortuna_api_list_obligations$;

-- Remove default PUBLIC EXECUTE; grant only the exact user-facing call graph.
REVOKE ALL ON FUNCTION fortuna_private.fortuna_get_current_book_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_ensure_current_book_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_create_contact(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_open_obligation(uuid, text, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_list_contacts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_list_obligations(uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_get_current_book_id() TO authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_ensure_current_book_id() TO authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_create_contact(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_open_obligation(uuid, text, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_list_contacts() TO authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_list_obligations(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION api.create_contact(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION api.open_obligation(uuid, text, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION api.list_contacts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION api.list_obligations(uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION api.create_contact(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION api.open_obligation(uuid, text, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION api.list_contacts() TO authenticated;
GRANT EXECUTE ON FUNCTION api.list_obligations(uuid, text, text) TO authenticated;

-- No direct table privileges are granted to anon/authenticated.
