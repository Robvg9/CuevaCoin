-- FORTUNA v1 PostgreSQL schema prototype for isolated PGlite tests ONLY.
-- This is NOT a Supabase migration and MUST NOT be applied to any live database.
-- Generate a real migration with `supabase migration new <name>` after design gates close.

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
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reverses_event_id uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id, contact_id) REFERENCES fortuna_private.financial_contacts(book_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (book_id, reverses_event_id) REFERENCES fortuna_private.financial_events(book_id, id) ON DELETE RESTRICT,
  CHECK ((event_type = 'reversal') = (reverses_event_id IS NOT NULL)),
  UNIQUE (book_id, id),
  UNIQUE (book_id, id, contact_id, currency_code)
);

CREATE TABLE fortuna_private.financial_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL,
  event_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  currency_code text NOT NULL,
  obligation_id uuid NULL,
  entry_kind text NOT NULL CHECK (
    entry_kind IN ('obligation_opened', 'cash_received', 'cash_paid', 'compensation', 'reversal', 'adjustment')
  ),
  signed_minor bigint NOT NULL CHECK (signed_minor <> 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id, event_id, contact_id, currency_code)
    REFERENCES fortuna_private.financial_events(book_id, id, contact_id, currency_code) ON DELETE RESTRICT,
  FOREIGN KEY (book_id, obligation_id, contact_id, currency_code)
    REFERENCES fortuna_private.financial_obligations(book_id, id, contact_id, currency_code) ON DELETE RESTRICT
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
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'committed')),
  event_id uuid NULL,
  response jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz NULL,
  FOREIGN KEY (book_id, event_id) REFERENCES fortuna_private.financial_events(book_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'processing' AND committed_at IS NULL)
    OR (status = 'committed' AND event_id IS NOT NULL AND committed_at IS NOT NULL)
  ),
  UNIQUE (book_id, idempotency_key)
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
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA fortuna_private TO service_role;
