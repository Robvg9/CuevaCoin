-- FORTUNA v1: covering indexes for private-ledger foreign keys.
-- These indexes cover the 15 LIVE Supabase Advisor findings in fortuna_private.
-- Fourteen indexes are sufficient because (book_id, event_id) also covers
-- financial_audit(book_id) by its leftmost prefix.
-- Existing indexes already cover the other private foreign keys.
-- Additive only: no table, row, grants, policies, functions, or schema changes.

BEGIN;

CREATE INDEX IF NOT EXISTS financial_allocations_book_event_contact_currency_fk_idx
  ON fortuna_private.financial_allocations (book_id, event_id, contact_id, currency_code);

CREATE INDEX IF NOT EXISTS financial_allocations_book_obligation_contact_currency_fk_idx
  ON fortuna_private.financial_allocations (book_id, obligation_id, contact_id, currency_code);

CREATE INDEX IF NOT EXISTS financial_audit_actor_user_fk_idx
  ON fortuna_private.financial_audit (actor_user_id);

CREATE INDEX IF NOT EXISTS financial_audit_book_event_fk_idx
  ON fortuna_private.financial_audit (book_id, event_id);

CREATE INDEX IF NOT EXISTS financial_contacts_linked_profile_fk_idx
  ON fortuna_private.financial_contacts (linked_profile_id);

CREATE INDEX IF NOT EXISTS financial_events_actor_user_fk_idx
  ON fortuna_private.financial_events (actor_user_id);

CREATE INDEX IF NOT EXISTS financial_events_book_reversal_contact_currency_fk_idx
  ON fortuna_private.financial_events (book_id, reverses_event_id, contact_id, currency_code);

CREATE INDEX IF NOT EXISTS financial_events_currency_fk_idx
  ON fortuna_private.financial_events (currency_code);

CREATE INDEX IF NOT EXISTS financial_idempotency_actor_user_fk_idx
  ON fortuna_private.financial_idempotency (actor_user_id);

CREATE INDEX IF NOT EXISTS financial_idempotency_book_event_fk_idx
  ON fortuna_private.financial_idempotency (book_id, event_id);

CREATE INDEX IF NOT EXISTS financial_ledger_book_event_contact_currency_fk_idx
  ON fortuna_private.financial_ledger_entries (book_id, event_id, contact_id, currency_code);

CREATE INDEX IF NOT EXISTS financial_ledger_book_obligation_contact_currency_fk_idx
  ON fortuna_private.financial_ledger_entries (book_id, obligation_id, contact_id, currency_code);

CREATE INDEX IF NOT EXISTS financial_obligations_created_by_fk_idx
  ON fortuna_private.financial_obligations (created_by);

CREATE INDEX IF NOT EXISTS financial_obligations_currency_fk_idx
  ON fortuna_private.financial_obligations (currency_code);

COMMIT;
