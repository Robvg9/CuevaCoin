-- FORTUNA v1 production foundation. Apply only after explicit LIVE migration gate.

-- Private ledger + owner-scoped API. No direct table exposure.

BEGIN;


CREATE SCHEMA IF NOT EXISTS fortuna_private;
REVOKE ALL ON SCHEMA fortuna_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA fortuna_private TO service_role;

CREATE TABLE fortuna_private.financial_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id),
  UNIQUE (id, owner_user_id)
);

CREATE TABLE fortuna_private.financial_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES fortuna_private.financial_books(id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  linked_profile_id uuid NULL REFERENCES public.perfiles(id) ON DELETE SET NULL,
  phone text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, id)
);

CREATE UNIQUE INDEX financial_contacts_linked_profile_unique_idx
  ON fortuna_private.financial_contacts (book_id, linked_profile_id)
  WHERE linked_profile_id IS NOT NULL;

CREATE TABLE fortuna_private.financial_currencies (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  minor_unit_scale smallint NOT NULL CHECK (minor_unit_scale BETWEEN 0 AND 6),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fortuna_private.financial_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  currency_code text NOT NULL REFERENCES fortuna_private.financial_currencies(code) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('receivable', 'payable')),
  principal_minor bigint NOT NULL CHECK (principal_minor > 0),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  due_at timestamptz NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id) REFERENCES fortuna_private.financial_books(id) ON DELETE RESTRICT,
  FOREIGN KEY (book_id, contact_id) REFERENCES fortuna_private.financial_contacts(book_id, id) ON DELETE RESTRICT,
  UNIQUE (book_id, id),
  UNIQUE (book_id, id, contact_id, currency_code)
);

CREATE TABLE fortuna_private.financial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  currency_code text NOT NULL REFERENCES fortuna_private.financial_currencies(code) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    event_type IN ('obligation_opened', 'cash_received', 'cash_paid', 'compensation', 'reversal', 'adjustment')
  ),
  total_amount_minor bigint NOT NULL CHECK (total_amount_minor > 0),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reverses_event_id uuid NULL,
  reversal_reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id, contact_id) REFERENCES fortuna_private.financial_contacts(book_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (book_id, reverses_event_id, contact_id, currency_code)
    REFERENCES fortuna_private.financial_events(book_id, id, contact_id, currency_code) ON DELETE RESTRICT,
  CHECK ((event_type = 'reversal') = (reverses_event_id IS NOT NULL)),
  CHECK ((event_type = 'reversal') = (reversal_reason IS NOT NULL)),
  CHECK (reversal_reason IS NULL OR length(btrim(reversal_reason)) > 0),
  CHECK (reverses_event_id IS NULL OR reverses_event_id <> id),
  UNIQUE (book_id, id),
  UNIQUE (book_id, id, contact_id, currency_code)
);

CREATE TABLE fortuna_private.financial_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL,
  event_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  currency_code text NOT NULL,
  obligation_id uuid NOT NULL,
  entry_kind text NOT NULL CHECK (
    entry_kind IN ('obligation_opened', 'cash_received', 'cash_paid', 'compensation', 'reversal', 'adjustment')
  ),
  signed_minor bigint NOT NULL CHECK (signed_minor <> 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id, event_id, contact_id, currency_code)
    REFERENCES fortuna_private.financial_events(book_id, id, contact_id, currency_code) ON DELETE RESTRICT,
  FOREIGN KEY (book_id, obligation_id, contact_id, currency_code)
    REFERENCES fortuna_private.financial_obligations(book_id, id, contact_id, currency_code) ON DELETE RESTRICT,
  UNIQUE (book_id, event_id, obligation_id)
);

CREATE TABLE fortuna_private.financial_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL,
  event_id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  currency_code text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id, event_id, contact_id, currency_code)
    REFERENCES fortuna_private.financial_events(book_id, id, contact_id, currency_code) ON DELETE RESTRICT,
  FOREIGN KEY (book_id, obligation_id, contact_id, currency_code)
    REFERENCES fortuna_private.financial_obligations(book_id, id, contact_id, currency_code) ON DELETE RESTRICT,
  UNIQUE (book_id, event_id, obligation_id)
);

CREATE TABLE fortuna_private.financial_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES fortuna_private.financial_books(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'committed')),
  event_id uuid NULL,
  response jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz NULL,
  FOREIGN KEY (book_id, event_id) REFERENCES fortuna_private.financial_events(book_id, id) ON DELETE RESTRICT,
  CONSTRAINT financial_idempotency_state_check CHECK (
    (status = 'processing' AND event_id IS NULL AND response IS NULL AND committed_at IS NULL)
    OR (status = 'committed' AND response IS NOT NULL AND committed_at IS NOT NULL)
  ),
  UNIQUE (book_id, actor_user_id, idempotency_key)
);

CREATE TABLE fortuna_private.financial_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES fortuna_private.financial_books(id) ON DELETE RESTRICT,
  event_id uuid NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id, event_id) REFERENCES fortuna_private.financial_events(book_id, id) ON DELETE RESTRICT
);

CREATE INDEX financial_contacts_book_name_idx
  ON fortuna_private.financial_contacts (book_id, lower(display_name));
CREATE INDEX financial_obligations_open_lookup_idx
  ON fortuna_private.financial_obligations (book_id, contact_id, currency_code, direction, opened_at);
CREATE INDEX financial_events_contact_time_idx
  ON fortuna_private.financial_events (book_id, contact_id, occurred_at DESC);
CREATE INDEX financial_ledger_contact_currency_idx
  ON fortuna_private.financial_ledger_entries (book_id, contact_id, currency_code, created_at);
CREATE INDEX financial_allocations_obligation_idx
  ON fortuna_private.financial_allocations (book_id, obligation_id);

ALTER TABLE fortuna_private.financial_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE fortuna_private.financial_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fortuna_private.financial_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE fortuna_private.financial_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fortuna_private.financial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fortuna_private.financial_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fortuna_private.financial_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fortuna_private.financial_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE fortuna_private.financial_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fortuna_private.reject_immutable_financial_data()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'fortuna_immutable_record: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

REVOKE ALL ON FUNCTION fortuna_private.reject_immutable_financial_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.reject_immutable_financial_data() TO service_role;

CREATE OR REPLACE FUNCTION fortuna_private.validate_financial_reversal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $fortuna$
DECLARE
  referenced_event_type text;
BEGIN
  SELECT event_type
    INTO referenced_event_type
    FROM fortuna_private.financial_events
   WHERE book_id = NEW.book_id
     AND id = NEW.reverses_event_id;

  IF referenced_event_type = 'reversal' THEN
    RAISE EXCEPTION 'fortuna_invalid_reversal_target: reversals cannot target another reversal';
  END IF;

  RETURN NEW;
END;
$fortuna$;

REVOKE ALL ON FUNCTION fortuna_private.validate_financial_reversal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.validate_financial_reversal() TO service_role;

CREATE OR REPLACE FUNCTION fortuna_private.guard_idempotency_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'processing' THEN
      RAISE EXCEPTION 'fortuna_idempotency_initial_state_invalid: a request must start in processing state';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.book_id IS DISTINCT FROM OLD.book_id
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'fortuna_idempotency_identity_immutable: request identity cannot be changed';
  END IF;

  IF OLD.status = 'committed' THEN
    RAISE EXCEPTION 'fortuna_idempotency_committed_immutable: committed results cannot be changed';
  END IF;

  IF NEW.status <> 'committed' THEN
    RAISE EXCEPTION 'fortuna_idempotency_transition_invalid: processing may only transition to committed';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION fortuna_private.guard_idempotency_transition() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.guard_idempotency_transition() TO service_role;

CREATE TRIGGER financial_events_validate_reversal
  BEFORE INSERT ON fortuna_private.financial_events
  FOR EACH ROW WHEN (NEW.event_type = 'reversal')
  EXECUTE FUNCTION fortuna_private.validate_financial_reversal();

CREATE TRIGGER financial_idempotency_guard_transition
  BEFORE INSERT OR UPDATE ON fortuna_private.financial_idempotency
  FOR EACH ROW EXECUTE FUNCTION fortuna_private.guard_idempotency_transition();

CREATE TRIGGER financial_obligations_immutable
  BEFORE UPDATE OR DELETE ON fortuna_private.financial_obligations
  FOR EACH ROW EXECUTE FUNCTION fortuna_private.reject_immutable_financial_data();
CREATE TRIGGER financial_events_immutable
  BEFORE UPDATE OR DELETE ON fortuna_private.financial_events
  FOR EACH ROW EXECUTE FUNCTION fortuna_private.reject_immutable_financial_data();
CREATE TRIGGER financial_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON fortuna_private.financial_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fortuna_private.reject_immutable_financial_data();
CREATE TRIGGER financial_allocations_immutable
  BEFORE UPDATE OR DELETE ON fortuna_private.financial_allocations
  FOR EACH ROW EXECUTE FUNCTION fortuna_private.reject_immutable_financial_data();
CREATE TRIGGER financial_audit_immutable
  BEFORE UPDATE OR DELETE ON fortuna_private.financial_audit
  FOR EACH ROW EXECUTE FUNCTION fortuna_private.reject_immutable_financial_data();

REVOKE ALL ON ALL TABLES IN SCHEMA fortuna_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA fortuna_private FROM service_role;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA fortuna_private TO service_role;
GRANT UPDATE (display_name, linked_profile_id, phone, notes, updated_at)
  ON fortuna_private.financial_contacts TO service_role;
GRANT UPDATE (status, event_id, response, committed_at)
  ON fortuna_private.financial_idempotency TO service_role;


INSERT INTO fortuna_private.financial_currencies (code, display_name, minor_unit_scale)

VALUES ('CUP', 'Cuban Peso', 2), ('USD', 'US Dollar', 2), ('EUR', 'Euro', 2)

ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name, minor_unit_scale = EXCLUDED.minor_unit_scale;


CREATE SCHEMA IF NOT EXISTS api;
REVOKE ALL ON SCHEMA api FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA api TO authenticated;

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

REVOKE ALL ON FUNCTION fortuna_private.fortuna_get_current_book_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_ensure_current_book_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_create_contact(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_open_obligation(uuid, text, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_list_contacts() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_get_current_book_id() TO authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_ensure_current_book_id() TO authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_create_contact(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_open_obligation(uuid, text, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_list_contacts() TO authenticated;

REVOKE ALL ON FUNCTION api.create_contact(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION api.open_obligation(uuid, text, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION api.list_contacts() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION api.create_contact(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION api.open_obligation(uuid, text, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION api.list_contacts() TO authenticated;




CREATE OR REPLACE FUNCTION fortuna_private.fortuna_calculate_settlement_plan(
  p_book_id uuid,
  p_contact_id uuid,
  p_currency_code text,
  p_flow text,
  p_mode text,
  p_total_amount_minor text,
  p_requested_allocations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $fortuna_settlement_plan$
DECLARE
  v_currency text;
  v_direction text;
  v_overage_direction text;
  v_amount bigint;
  v_scale smallint;
  v_eligible jsonb := '[]'::jsonb;
  v_allocations jsonb := '[]'::jsonb;
  v_item record;
  v_requested_count integer := 0;
  v_distinct_count integer := 0;
  v_remaining bigint;
  v_take bigint;
  v_left bigint;
  v_allocated bigint := 0;
  v_overage bigint := 0;
  v_fingerprint text;
  v_snapshot jsonb;
  v_corrupt boolean;
BEGIN
  IF p_book_id IS NULL OR p_contact_id IS NULL THEN
    RAISE EXCEPTION 'fortuna_settlement_resource_not_found';
  END IF;

  IF p_flow IS NULL OR p_flow NOT IN ('cash_received', 'cash_paid') THEN
    RAISE EXCEPTION 'fortuna_settlement_invalid_flow';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('fifo', 'manual') THEN
    RAISE EXCEPTION 'fortuna_settlement_invalid_mode';
  END IF;

  IF p_total_amount_minor IS NULL
     OR p_total_amount_minor !~ '^[1-9][0-9]{0,18}$' THEN
    RAISE EXCEPTION 'fortuna_settlement_amount_invalid';
  END IF;

  BEGIN
    v_amount := p_total_amount_minor::bigint;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'fortuna_settlement_amount_invalid';
  END;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'fortuna_settlement_amount_must_be_positive';
  END IF;

  IF p_requested_allocations IS NULL
     OR jsonb_typeof(p_requested_allocations) <> 'array' THEN
    RAISE EXCEPTION 'fortuna_settlement_allocations_must_be_array';
  END IF;

  IF p_mode = 'fifo' AND jsonb_array_length(p_requested_allocations) <> 0 THEN
    RAISE EXCEPTION 'fortuna_settlement_fifo_cannot_include_manual_allocations';
  END IF;

  v_currency := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency_code, '')));
  IF v_currency NOT IN ('CUP', 'USD', 'EUR') THEN
    RAISE EXCEPTION 'fortuna_currency_not_supported';
  END IF;

  SELECT c.minor_unit_scale
    INTO v_scale
    FROM fortuna_private.financial_currencies AS c
   WHERE c.code = v_currency
     AND c.is_active = true;

  IF NOT FOUND OR v_scale <> 2 THEN
    RAISE EXCEPTION 'fortuna_currency_configuration_invalid';
  END IF;

  PERFORM 1
    FROM fortuna_private.financial_contacts AS c
   WHERE c.book_id = p_book_id
     AND c.id = p_contact_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fortuna_settlement_resource_not_found';
  END IF;

  v_direction := CASE WHEN p_flow = 'cash_received' THEN 'receivable' ELSE 'payable' END;
  v_overage_direction := CASE WHEN p_flow = 'cash_received' THEN 'payable' ELSE 'receivable' END;

  SELECT EXISTS (
    SELECT 1
      FROM (
        SELECT
          o.direction,
          COALESCE(pg_catalog.sum(l.signed_minor), 0)::bigint AS signed_balance
        FROM fortuna_private.financial_obligations AS o
        LEFT JOIN fortuna_private.financial_ledger_entries AS l
          ON l.book_id = o.book_id
         AND l.obligation_id = o.id
        WHERE o.book_id = p_book_id
          AND o.contact_id = p_contact_id
          AND o.currency_code = v_currency
          AND o.direction = v_direction
        GROUP BY o.id, o.direction
      ) AS balances
     WHERE (balances.direction = 'receivable' AND balances.signed_balance < 0)
        OR (balances.direction = 'payable' AND balances.signed_balance > 0)
  )
    INTO v_corrupt;

  IF v_corrupt THEN
    RAISE EXCEPTION 'fortuna_settlement_obligation_ledger_direction_corrupt';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'obligation_id', eligible.id,
        'opened_at', eligible.opened_at,
        'remaining_minor', eligible.remaining_minor::text
      )
      ORDER BY eligible.opened_at, eligible.id
    ),
    '[]'::jsonb
  )
    INTO v_eligible
    FROM (
      SELECT
        o.id,
        o.opened_at,
        CASE
          WHEN o.direction = 'receivable'
            THEN COALESCE(pg_catalog.sum(l.signed_minor), 0)::bigint
          ELSE -COALESCE(pg_catalog.sum(l.signed_minor), 0)::bigint
        END AS remaining_minor
      FROM fortuna_private.financial_obligations AS o
      LEFT JOIN fortuna_private.financial_ledger_entries AS l
        ON l.book_id = o.book_id
       AND l.obligation_id = o.id
      WHERE o.book_id = p_book_id
        AND o.contact_id = p_contact_id
        AND o.currency_code = v_currency
        AND o.direction = v_direction
      GROUP BY o.id, o.opened_at, o.direction
      HAVING CASE
        WHEN o.direction = 'receivable'
          THEN COALESCE(pg_catalog.sum(l.signed_minor), 0)::bigint
        ELSE -COALESCE(pg_catalog.sum(l.signed_minor), 0)::bigint
      END > 0
    ) AS eligible;

  v_left := v_amount;

  IF p_mode = 'fifo' THEN
    FOR v_item IN
      SELECT
        item.obligation_id,
        item.remaining_minor::bigint AS remaining_minor
      FROM jsonb_to_recordset(v_eligible)
        AS item(obligation_id uuid, opened_at timestamptz, remaining_minor text)
      ORDER BY item.opened_at, item.obligation_id
    LOOP
      EXIT WHEN v_left = 0;
      v_take := LEAST(v_item.remaining_minor, v_left);
      IF v_take > 0 THEN
        v_allocations := v_allocations || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'obligation_id', v_item.obligation_id,
            'amount_minor', v_take::text
          )
        );
        v_allocated := v_allocated + v_take;
        v_left := v_left - v_take;
      END IF;
    END LOOP;
  ELSE
    SELECT
      COUNT(*)::integer,
      COUNT(DISTINCT item.obligation_id)::integer
      INTO v_requested_count, v_distinct_count
      FROM jsonb_to_recordset(p_requested_allocations)
        AS item(obligation_id uuid, amount_minor text);

    IF v_requested_count <> v_distinct_count THEN
      RAISE EXCEPTION 'fortuna_settlement_duplicate_manual_obligation';
    END IF;

    FOR v_item IN
      SELECT item.obligation_id, item.amount_minor
        FROM jsonb_to_recordset(p_requested_allocations)
          AS item(obligation_id uuid, amount_minor text)
       ORDER BY item.obligation_id
    LOOP
      IF v_item.obligation_id IS NULL
         OR v_item.amount_minor IS NULL
         OR v_item.amount_minor !~ '^[1-9][0-9]{0,18}$' THEN
        RAISE EXCEPTION 'fortuna_settlement_manual_amount_invalid';
      END IF;

      BEGIN
        v_take := v_item.amount_minor::bigint;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          RAISE EXCEPTION 'fortuna_settlement_manual_amount_invalid';
      END;

      SELECT item.remaining_minor::bigint
        INTO v_remaining
        FROM jsonb_to_recordset(v_eligible)
          AS item(obligation_id uuid, opened_at timestamptz, remaining_minor text)
       WHERE item.obligation_id = v_item.obligation_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'fortuna_settlement_manual_obligation_not_found';
      END IF;

      IF v_take > v_remaining THEN
        RAISE EXCEPTION 'fortuna_settlement_manual_exceeds_real_pending_balance';
      END IF;

      v_allocations := v_allocations || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'obligation_id', v_item.obligation_id,
          'amount_minor', v_take::text
        )
      );
      v_allocated := v_allocated + v_take;
    END LOOP;

    IF v_allocated > v_amount THEN
      RAISE EXCEPTION 'fortuna_settlement_allocations_exceed_cash_amount';
    END IF;
  END IF;

  IF v_allocated > v_amount THEN
    RAISE EXCEPTION 'fortuna_settlement_allocations_exceed_cash_amount';
  END IF;

  v_overage := v_amount - v_allocated;

  v_snapshot := pg_catalog.jsonb_build_object(
    'version', 1,
    'book_id', p_book_id,
    'contact_id', p_contact_id,
    'currency', v_currency,
    'flow', p_flow,
    'mode', p_mode,
    'total_amount_minor', v_amount::text,
    'eligible_obligations', v_eligible,
    'allocations', v_allocations,
    'allocated_minor', v_allocated::text,
    'overage_minor', v_overage::text,
    'overage_direction', CASE WHEN v_overage > 0 THEN v_overage_direction ELSE NULL END
  );

  v_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_snapshot::text, 'UTF8')),
    'hex'
  );

  RETURN v_snapshot || pg_catalog.jsonb_build_object(
    'preview_fingerprint', v_fingerprint
  );
END;
$fortuna_settlement_plan$;

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_preview_settlement(
  p_contact_id uuid,
  p_currency_code text,
  p_flow text,
  p_mode text,
  p_total_amount_minor text,
  p_requested_allocations jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_preview_settlement$
DECLARE
  v_book_id uuid;
  v_plan jsonb;
BEGIN
  v_book_id := fortuna_private.fortuna_get_current_book_id();
  IF v_book_id IS NULL THEN
    RAISE EXCEPTION 'fortuna_book_not_found';
  END IF;

  PERFORM 1
    FROM fortuna_private.financial_contacts AS c
   WHERE c.id = p_contact_id
     AND c.book_id = v_book_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fortuna_settlement_resource_not_found';
  END IF;

  v_plan := fortuna_private.fortuna_calculate_settlement_plan(
    v_book_id,
    p_contact_id,
    p_currency_code,
    p_flow,
    p_mode,
    p_total_amount_minor,
    COALESCE(p_requested_allocations, '[]'::jsonb)
  );

  RETURN v_plan;
END;
$fortuna_preview_settlement$;

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_commit_settlement(
  p_contact_id uuid,
  p_currency_code text,
  p_flow text,
  p_mode text,
  p_total_amount_minor text,
  p_requested_allocations jsonb,
  p_preview_fingerprint text,
  p_confirm_overage boolean,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_commit_settlement$
DECLARE
  v_actor uuid;
  v_book_id uuid;
  v_currency text;
  v_expected_direction text;
  v_cash_sign bigint;
  v_key text;
  v_preview_fingerprint text;
  v_payload jsonb;
  v_payload_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_response jsonb;
  v_plan jsonb;
  v_allocations jsonb;
  v_allocated bigint;
  v_overage bigint;
  v_amount bigint;
  v_event_id uuid;
  v_overage_obligation_id uuid;
  v_signed_total bigint;
  v_response jsonb;
  v_item record;
  v_contact_id uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;

  IF p_contact_id IS NULL THEN
    RAISE EXCEPTION 'fortuna_settlement_resource_not_found';
  END IF;

  v_currency := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency_code, '')));
  v_key := pg_catalog.btrim(COALESCE(p_idempotency_key, ''));
  v_preview_fingerprint := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_preview_fingerprint, '')));

  IF pg_catalog.length(v_key) < 8 OR pg_catalog.length(v_key) > 200 THEN
    RAISE EXCEPTION 'fortuna_idempotency_key_invalid';
  END IF;
  IF v_preview_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'fortuna_preview_fingerprint_invalid';
  END IF;
  IF p_confirm_overage IS NULL THEN
    RAISE EXCEPTION 'fortuna_overage_confirmation_required';
  END IF;
  IF p_flow IS NULL OR p_flow NOT IN ('cash_received', 'cash_paid') THEN
    RAISE EXCEPTION 'fortuna_settlement_invalid_flow';
  END IF;

  v_expected_direction := CASE WHEN p_flow = 'cash_received' THEN 'receivable' ELSE 'payable' END;
  v_cash_sign := CASE WHEN p_flow = 'cash_received' THEN -1 ELSE 1 END;
  v_book_id := fortuna_private.fortuna_ensure_current_book_id();

  -- Lock the contact first. This serializes settlement/open-obligation commands
  -- for the same contact and prevents a new obligation from joining the snapshot.
  SELECT c.id
    INTO v_contact_id
    FROM fortuna_private.financial_contacts AS c
   WHERE c.id = p_contact_id
     AND c.book_id = v_book_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fortuna_settlement_resource_not_found';
  END IF;

  v_payload := pg_catalog.jsonb_build_object(
    'version', 1,
    'command', CASE WHEN p_flow = 'cash_received' THEN 'receive_cash' ELSE 'pay_contact' END,
    'contact_id', p_contact_id,
    'currency', v_currency,
    'flow', p_flow,
    'mode', p_mode,
    'total_amount_minor', p_total_amount_minor,
    'requested_allocations', COALESCE(p_requested_allocations, '[]'::jsonb),
    'preview_fingerprint', v_preview_fingerprint,
    'confirm_overage', p_confirm_overage
  );
  v_payload_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_payload::text, 'UTF8')),
    'hex'
  );

  -- Reserve/replay before checking preview freshness. A retry of a committed
  -- identical command must return its saved result even though balances changed.
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

  -- Lock all obligations that contribute to this contact/currency/direction.
  -- The parent contact lock also prevents new obligations from joining this set.
  PERFORM o.id
    FROM fortuna_private.financial_obligations AS o
   WHERE o.book_id = v_book_id
     AND o.contact_id = p_contact_id
     AND o.currency_code = v_currency
     AND o.direction = v_expected_direction
   ORDER BY o.id
   FOR UPDATE;

  v_plan := fortuna_private.fortuna_calculate_settlement_plan(
    v_book_id,
    p_contact_id,
    v_currency,
    p_flow,
    p_mode,
    p_total_amount_minor,
    COALESCE(p_requested_allocations, '[]'::jsonb)
  );

  IF v_plan->>'preview_fingerprint' <> v_preview_fingerprint THEN
    RAISE EXCEPTION 'fortuna_stale_preview';
  END IF;

  v_amount := (v_plan->>'total_amount_minor')::bigint;
  v_allocated := (v_plan->>'allocated_minor')::bigint;
  v_overage := (v_plan->>'overage_minor')::bigint;
  v_allocations := v_plan->'allocations';

  IF v_overage > 0 AND p_confirm_overage IS NOT TRUE THEN
    RAISE EXCEPTION 'fortuna_overage_confirmation_required';
  END IF;

  INSERT INTO fortuna_private.financial_events (
    book_id, contact_id, currency_code, event_type,
    total_amount_minor, actor_user_id
  )
  VALUES (
    v_book_id, p_contact_id, v_currency, p_flow,
    v_amount, v_actor
  )
  RETURNING id INTO v_event_id;

  FOR v_item IN
    SELECT item.obligation_id, item.amount_minor::bigint AS amount_minor
      FROM jsonb_to_recordset(v_allocations)
        AS item(obligation_id uuid, amount_minor text)
  LOOP
    INSERT INTO fortuna_private.financial_allocations (
      book_id, event_id, obligation_id, contact_id, currency_code, amount_minor
    )
    VALUES (
      v_book_id, v_event_id, v_item.obligation_id, p_contact_id, v_currency, v_item.amount_minor
    );

    INSERT INTO fortuna_private.financial_ledger_entries (
      book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor
    )
    VALUES (
      v_book_id, v_event_id, p_contact_id, v_currency,
      v_item.obligation_id, p_flow, v_cash_sign * v_item.amount_minor
    );
  END LOOP;

  IF v_overage > 0 THEN
    INSERT INTO fortuna_private.financial_obligations (
      book_id, contact_id, currency_code, direction, principal_minor,
      description, created_by
    )
    VALUES (
      v_book_id,
      p_contact_id,
      v_currency,
      CASE WHEN p_flow = 'cash_received' THEN 'payable' ELSE 'receivable' END,
      v_overage,
      'Confirmed overage from settlement event ' || v_event_id::text,
      v_actor
    )
    RETURNING id INTO v_overage_obligation_id;

    INSERT INTO fortuna_private.financial_ledger_entries (
      book_id, event_id, contact_id, currency_code,
      obligation_id, entry_kind, signed_minor
    )
    VALUES (
      v_book_id, v_event_id, p_contact_id, v_currency,
      v_overage_obligation_id, p_flow, v_cash_sign * v_overage
    );
  END IF;

  SELECT COALESCE(pg_catalog.sum(l.signed_minor), 0)::bigint
    INTO v_signed_total
    FROM fortuna_private.financial_ledger_entries AS l
   WHERE l.book_id = v_book_id
     AND l.event_id = v_event_id;

  IF v_signed_total <> v_cash_sign * v_amount THEN
    RAISE EXCEPTION 'fortuna_settlement_ledger_does_not_reconcile_to_cash_total';
  END IF;

  INSERT INTO fortuna_private.financial_audit (
    book_id, event_id, actor_user_id, action, details
  )
  VALUES (
    v_book_id,
    v_event_id,
    v_actor,
    p_flow,
    pg_catalog.jsonb_build_object(
      'mode', p_mode,
      'allocated_minor', v_allocated::text,
      'overage_minor', v_overage::text,
      'confirmed_overage', p_confirm_overage,
      'preview_fingerprint', v_preview_fingerprint
    )
  );

  v_response := pg_catalog.jsonb_build_object(
    'event_id', v_event_id,
    'flow', p_flow,
    'mode', p_mode,
    'currency', v_currency,
    'total_amount_minor', v_amount::text,
    'allocated_minor', v_allocated::text,
    'overage_minor', v_overage::text,
    'allocations', v_allocations,
    'overage_obligation_id', v_overage_obligation_id
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
$fortuna_commit_settlement$;

CREATE OR REPLACE FUNCTION api.preview_settlement(
  p_contact_id uuid,
  p_currency_code text,
  p_flow text,
  p_mode text,
  p_total_amount_minor text,
  p_requested_allocations jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_preview_settlement$
  SELECT fortuna_private.fortuna_preview_settlement($1, $2, $3, $4, $5, $6);
$fortuna_api_preview_settlement$;

CREATE OR REPLACE FUNCTION api.receive_cash(
  p_contact_id uuid,
  p_currency_code text,
  p_mode text,
  p_total_amount_minor text,
  p_requested_allocations jsonb,
  p_preview_fingerprint text,
  p_confirm_overage boolean,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_receive_cash$
  SELECT fortuna_private.fortuna_commit_settlement(
    $1, $2, 'cash_received', $3, $4, $5, $6, $7, $8
  );
$fortuna_api_receive_cash$;

CREATE OR REPLACE FUNCTION api.pay_contact(
  p_contact_id uuid,
  p_currency_code text,
  p_mode text,
  p_total_amount_minor text,
  p_requested_allocations jsonb,
  p_preview_fingerprint text,
  p_confirm_overage boolean,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_pay_contact$
  SELECT fortuna_private.fortuna_commit_settlement(
    $1, $2, 'cash_paid', $3, $4, $5, $6, $7, $8
  );
$fortuna_api_pay_contact$;

REVOKE ALL ON FUNCTION fortuna_private.fortuna_calculate_settlement_plan(
  uuid, uuid, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION fortuna_private.fortuna_preview_settlement(
  uuid, text, text, text, text, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_commit_settlement(
  uuid, text, text, text, text, jsonb, text, boolean, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_preview_settlement(
  uuid, text, text, text, text, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_commit_settlement(
  uuid, text, text, text, text, jsonb, text, boolean, text
) TO authenticated;

REVOKE ALL ON FUNCTION api.preview_settlement(
  uuid, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION api.receive_cash(
  uuid, text, text, text, jsonb, text, boolean, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION api.pay_contact(
  uuid, text, text, text, jsonb, text, boolean, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION api.preview_settlement(
  uuid, text, text, text, text, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION api.receive_cash(
  uuid, text, text, text, jsonb, text, boolean, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION api.pay_contact(
  uuid, text, text, text, jsonb, text, boolean, text
) TO authenticated;




-- Owner-scoped obligation detail for the real UI. The private schema remains
-- unexposed; callers reach this only through the SECURITY INVOKER api wrapper.
-- The production function matches the reviewed test contract: optional filters,
-- non-enumerating owner scoping, and balances derived from immutable ledger lines.
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
  IF v_book_id IS NULL OR p_contact_id IS NULL THEN
    RAISE EXCEPTION 'fortuna_contact_not_found';
  END IF;

  v_currency := NULLIF(pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency_code, ''))), '');
  v_direction := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_direction, ''))), '');

  IF v_currency IS NOT NULL AND v_currency NOT IN ('CUP', 'USD', 'EUR') THEN
    RAISE EXCEPTION 'fortuna_currency_not_supported';
  END IF;
  IF v_direction IS NOT NULL AND v_direction NOT IN ('receivable', 'payable') THEN
    RAISE EXCEPTION 'fortuna_obligation_direction_invalid';
  END IF;

  PERFORM 1
    FROM fortuna_private.financial_contacts AS c
   WHERE c.book_id = v_book_id
     AND c.id = p_contact_id;
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
      o.opened_at,
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
             o.principal_minor, o.description, o.due_at, o.opened_at, o.created_at
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
        'opened_at', b.opened_at,
        'created_at', b.created_at
      )
      ORDER BY b.opened_at, b.id
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

REVOKE ALL ON FUNCTION fortuna_private.fortuna_list_obligations(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_list_obligations(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION api.list_obligations(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_obligations(uuid, text, text) TO authenticated;


COMMIT;