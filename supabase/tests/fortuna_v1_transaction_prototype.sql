-- FORTUNA transaction envelope used by the isolated PGlite harness ONLY.
-- This is test code, NOT a production RPC, migration, or approved API.
-- It accepts actor/book identifiers only to simulate a trusted server caller.
-- Production must derive actor from a verified session and resolve/authorize the book server-side.

CREATE OR REPLACE FUNCTION fortuna_private.test_commit_event_atomic(
  p_book_id uuid,
  p_contact_id uuid,
  p_currency_code text,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_event_type text,
  p_total_amount_minor bigint,
  p_allocations jsonb,
  p_ledger_lines jsonb,
  p_reverses_event_id uuid,
  p_reversal_reason text,
  p_fail_after text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $fortuna_test$
DECLARE
  v_payload_sha256 text;
  v_idempotency_status text;
  v_existing_response jsonb;
  v_event_id uuid;
  v_response jsonb;
BEGIN
  IF p_fail_after IS NOT NULL
     AND p_fail_after NOT IN (
       'after_processing',
       'after_event',
       'after_allocations',
       'after_ledger',
       'after_audit',
       'after_idempotency_commit'
     ) THEN
    RAISE EXCEPTION 'fortuna_test_invalid_failpoint: %', p_fail_after;
  END IF;

  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'fortuna_test_allocations_must_be_array';
  END IF;

  IF p_ledger_lines IS NULL OR jsonb_typeof(p_ledger_lines) <> 'array' THEN
    RAISE EXCEPTION 'fortuna_test_ledger_lines_must_be_array';
  END IF;

  IF jsonb_array_length(p_ledger_lines) = 0 THEN
    RAISE EXCEPTION 'fortuna_test_ledger_lines_required';
  END IF;

  INSERT INTO fortuna_private.financial_idempotency (
    book_id,
    actor_user_id,
    idempotency_key,
    payload_sha256
  )
  VALUES (
    p_book_id,
    p_actor_user_id,
    p_idempotency_key,
    p_payload_sha256
  )
  ON CONFLICT (book_id, actor_user_id, idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT payload_sha256, status, response
      INTO v_payload_sha256, v_idempotency_status, v_existing_response
      FROM fortuna_private.financial_idempotency
     WHERE book_id = p_book_id
       AND actor_user_id = p_actor_user_id
       AND idempotency_key = p_idempotency_key
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'fortuna_idempotency_reservation_missing';
    END IF;

    IF v_payload_sha256 <> p_payload_sha256 THEN
      RAISE EXCEPTION 'fortuna_idempotency_conflict: same key with a different payload';
    END IF;

    IF v_idempotency_status = 'committed' THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'fortuna_idempotency_in_progress: reservation is not committed';
  END IF;

  IF p_fail_after = 'after_processing' THEN
    RAISE EXCEPTION 'fortuna_test_failpoint: after_processing';
  END IF;

  INSERT INTO fortuna_private.financial_events (
    book_id,
    contact_id,
    currency_code,
    event_type,
    total_amount_minor,
    actor_user_id,
    reverses_event_id,
    reversal_reason
  )
  VALUES (
    p_book_id,
    p_contact_id,
    p_currency_code,
    p_event_type,
    p_total_amount_minor,
    p_actor_user_id,
    p_reverses_event_id,
    p_reversal_reason
  )
  RETURNING id INTO v_event_id;

  IF p_fail_after = 'after_event' THEN
    RAISE EXCEPTION 'fortuna_test_failpoint: after_event';
  END IF;

  INSERT INTO fortuna_private.financial_allocations (
    book_id,
    event_id,
    obligation_id,
    contact_id,
    currency_code,
    amount_minor
  )
  SELECT
    p_book_id,
    v_event_id,
    item.obligation_id,
    p_contact_id,
    p_currency_code,
    item.amount_minor
  FROM jsonb_to_recordset(p_allocations)
       AS item(obligation_id uuid, amount_minor bigint);

  IF p_fail_after = 'after_allocations' THEN
    RAISE EXCEPTION 'fortuna_test_failpoint: after_allocations';
  END IF;

  INSERT INTO fortuna_private.financial_ledger_entries (
    book_id,
    event_id,
    contact_id,
    currency_code,
    obligation_id,
    entry_kind,
    signed_minor
  )
  SELECT
    p_book_id,
    v_event_id,
    p_contact_id,
    p_currency_code,
    item.obligation_id,
    p_event_type,
    item.signed_minor
  FROM jsonb_to_recordset(p_ledger_lines)
       AS item(obligation_id uuid, signed_minor bigint);

  IF p_fail_after = 'after_ledger' THEN
    RAISE EXCEPTION 'fortuna_test_failpoint: after_ledger';
  END IF;

  INSERT INTO fortuna_private.financial_audit (
    book_id,
    event_id,
    actor_user_id,
    action,
    details
  )
  VALUES (
    p_book_id,
    v_event_id,
    p_actor_user_id,
    p_event_type,
    jsonb_build_object(
      'total_amount_minor', p_total_amount_minor,
      'allocation_count', jsonb_array_length(p_allocations),
      'ledger_line_count', jsonb_array_length(p_ledger_lines)
    )
  );

  IF p_fail_after = 'after_audit' THEN
    RAISE EXCEPTION 'fortuna_test_failpoint: after_audit';
  END IF;

  v_response := jsonb_build_object(
    'event_id', v_event_id,
    'event_type', p_event_type,
    'total_amount_minor', p_total_amount_minor
  );

  UPDATE fortuna_private.financial_idempotency
     SET status = 'committed',
         event_id = v_event_id,
         response = v_response,
         committed_at = now()
   WHERE book_id = p_book_id
     AND actor_user_id = p_actor_user_id
     AND idempotency_key = p_idempotency_key
     AND status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fortuna_idempotency_commit_missing';
  END IF;

  IF p_fail_after = 'after_idempotency_commit' THEN
    RAISE EXCEPTION 'fortuna_test_failpoint: after_idempotency_commit';
  END IF;

  RETURN v_response;
END;
$fortuna_test$;

REVOKE ALL ON FUNCTION fortuna_private.test_commit_event_atomic(
  uuid, uuid, text, uuid, text, text, text, bigint, jsonb, jsonb, uuid, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fortuna_private.test_commit_event_atomic(
  uuid, uuid, text, uuid, text, text, text, bigint, jsonb, jsonb, uuid, text, text
) TO service_role;
