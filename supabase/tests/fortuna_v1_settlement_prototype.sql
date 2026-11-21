-- FORTUNA v1 settlement operation prototype for isolated PGlite tests ONLY.
-- This is NOT a production RPC, migration, endpoint, or approved API.
-- Actor/book IDs simulate a trusted server caller; production must verify the session
-- and resolve/authorize the book on the server before invoking any financial operation.

CREATE OR REPLACE FUNCTION fortuna_private.test_commit_settlement_atomic(
  p_book_id uuid,
  p_contact_id uuid,
  p_currency_code text,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_flow text,
  p_mode text,
  p_total_amount_minor bigint,
  p_requested_allocations jsonb,
  p_confirm_overage boolean,
  p_fail_after text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $fortuna_settlement_test$
DECLARE
  v_hash text;
  v_status text;
  v_existing_response jsonb;
  v_direction text;
  v_expected_direction text;
  v_cash_sign bigint;
  v_event_id uuid;
  v_allocations jsonb := '[]'::jsonb;
  v_item record;
  v_requested_count integer := 0;
  v_distinct_count integer := 0;
  v_locked_count integer := 0;
  v_remaining bigint;
  v_take bigint;
  v_allocated bigint := 0;
  v_overage bigint := 0;
  v_left bigint;
  v_overage_obligation_id uuid;
  v_response jsonb;
  v_written_total bigint;
BEGIN
  IF p_flow IS NULL OR p_flow NOT IN ('cash_received', 'cash_paid') THEN
    RAISE EXCEPTION 'fortuna_settlement_invalid_flow';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('fifo', 'manual') THEN
    RAISE EXCEPTION 'fortuna_settlement_invalid_mode';
  END IF;

  IF p_total_amount_minor IS NULL OR p_total_amount_minor <= 0 THEN
    RAISE EXCEPTION 'fortuna_settlement_amount_must_be_positive';
  END IF;

  IF p_requested_allocations IS NULL
     OR jsonb_typeof(p_requested_allocations) <> 'array' THEN
    RAISE EXCEPTION 'fortuna_settlement_allocations_must_be_array';
  END IF;

  IF p_mode = 'fifo' AND jsonb_array_length(p_requested_allocations) <> 0 THEN
    RAISE EXCEPTION 'fortuna_settlement_fifo_cannot_include_manual_allocations';
  END IF;

  IF p_fail_after IS NOT NULL
     AND p_fail_after NOT IN ('after_processing', 'after_event', 'after_allocations', 'after_overage_obligation', 'after_ledger', 'after_audit', 'after_idempotency_commit') THEN
    RAISE EXCEPTION 'fortuna_settlement_invalid_failpoint';
  END IF;

  v_expected_direction := CASE WHEN p_flow = 'cash_received' THEN 'receivable' ELSE 'payable' END;
  v_cash_sign := CASE WHEN p_flow = 'cash_received' THEN -1 ELSE 1 END;

  IF p_mode = 'manual' THEN
    SELECT count(*)::integer, count(DISTINCT item.obligation_id)::integer
      INTO v_requested_count, v_distinct_count
      FROM jsonb_to_recordset(p_requested_allocations)
        AS item(obligation_id uuid, amount_minor bigint);

    IF v_requested_count <> v_distinct_count THEN
      RAISE EXCEPTION 'fortuna_settlement_duplicate_manual_obligation';
    END IF;
  END IF;

  INSERT INTO fortuna_private.financial_idempotency (
    book_id, actor_user_id, idempotency_key, payload_sha256
  )
  VALUES (
    p_book_id, p_actor_user_id, p_idempotency_key, p_payload_sha256
  )
  ON CONFLICT (book_id, actor_user_id, idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT payload_sha256, status, response
      INTO v_hash, v_status, v_existing_response
      FROM fortuna_private.financial_idempotency
     WHERE book_id = p_book_id
       AND actor_user_id = p_actor_user_id
       AND idempotency_key = p_idempotency_key
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'fortuna_idempotency_reservation_missing';
    END IF;

    IF v_hash <> p_payload_sha256 THEN
      RAISE EXCEPTION 'fortuna_idempotency_conflict';
    END IF;

    IF v_status = 'committed' THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'fortuna_idempotency_in_progress';
  END IF;

  IF p_fail_after = 'after_processing' THEN
    RAISE EXCEPTION 'fortuna_settlement_test_failpoint: after_processing';
  END IF;

  -- Lock every eligible FIFO candidate by stable UUID order before reading balances.
  -- This ordering is deterministic; PGlite itself does not simulate concurrent sessions.
  IF p_mode = 'fifo' THEN
    PERFORM o.id
      FROM fortuna_private.financial_obligations o
     WHERE o.book_id = p_book_id
       AND o.contact_id = p_contact_id
       AND o.currency_code = p_currency_code
       AND o.direction = v_expected_direction
     ORDER BY o.id
     FOR UPDATE;
  ELSE
    PERFORM o.id
      FROM fortuna_private.financial_obligations o
     WHERE o.book_id = p_book_id
       AND o.contact_id = p_contact_id
       AND o.currency_code = p_currency_code
       AND o.id IN (
         SELECT item.obligation_id
           FROM jsonb_to_recordset(p_requested_allocations)
             AS item(obligation_id uuid, amount_minor bigint)
       )
     ORDER BY o.id
     FOR UPDATE;

    GET DIAGNOSTICS v_locked_count = ROW_COUNT;
    IF v_locked_count <> v_requested_count THEN
      RAISE EXCEPTION 'fortuna_settlement_manual_obligation_not_in_contact_currency_or_book';
    END IF;
  END IF;

  v_allocations := '[]'::jsonb;
  v_left := p_total_amount_minor;

  IF p_mode = 'fifo' THEN
    FOR v_item IN
      SELECT
        o.id,
        o.direction,
        o.opened_at,
        COALESCE(sum(l.signed_minor), 0)::bigint AS signed_balance
      FROM fortuna_private.financial_obligations o
      LEFT JOIN fortuna_private.financial_ledger_entries l
        ON l.book_id = o.book_id
       AND l.obligation_id = o.id
      WHERE o.book_id = p_book_id
        AND o.contact_id = p_contact_id
        AND o.currency_code = p_currency_code
        AND o.direction = v_expected_direction
      GROUP BY o.id, o.direction, o.opened_at
      ORDER BY o.opened_at, o.id
    LOOP
      IF (v_expected_direction = 'receivable' AND v_item.signed_balance < 0)
         OR (v_expected_direction = 'payable' AND v_item.signed_balance > 0) THEN
        RAISE EXCEPTION 'fortuna_settlement_obligation_ledger_direction_corrupt';
      END IF;

      v_remaining := CASE
        WHEN v_expected_direction = 'receivable' THEN v_item.signed_balance
        ELSE -v_item.signed_balance
      END;

      IF v_remaining <= 0 OR v_left <= 0 THEN
        CONTINUE;
      END IF;

      v_take := LEAST(v_remaining, v_left);
      v_allocations := v_allocations || jsonb_build_array(
        jsonb_build_object('obligation_id', v_item.id, 'amount_minor', v_take)
      );
      v_allocated := v_allocated + v_take;
      v_left := v_left - v_take;

      EXIT WHEN v_left = 0;
    END LOOP;
  ELSE
    FOR v_item IN
      SELECT item.obligation_id, item.amount_minor
        FROM jsonb_to_recordset(p_requested_allocations)
          AS item(obligation_id uuid, amount_minor bigint)
    LOOP
      IF v_item.amount_minor IS NULL OR v_item.amount_minor <= 0 THEN
        RAISE EXCEPTION 'fortuna_settlement_manual_amount_must_be_positive';
      END IF;

      SELECT
        o.direction,
        CASE
          WHEN o.direction = 'receivable' THEN COALESCE(sum(l.signed_minor), 0)::bigint
          ELSE -COALESCE(sum(l.signed_minor), 0)::bigint
        END
        INTO v_direction, v_remaining
        FROM fortuna_private.financial_obligations o
        LEFT JOIN fortuna_private.financial_ledger_entries l
          ON l.book_id = o.book_id
         AND l.obligation_id = o.id
       WHERE o.book_id = p_book_id
         AND o.contact_id = p_contact_id
         AND o.currency_code = p_currency_code
         AND o.id = v_item.obligation_id
       GROUP BY o.id, o.direction;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'fortuna_settlement_manual_obligation_not_found';
      END IF;

      IF v_direction <> v_expected_direction THEN
        RAISE EXCEPTION 'fortuna_settlement_manual_direction_mismatch';
      END IF;

      IF v_remaining <= 0 OR v_item.amount_minor > v_remaining THEN
        RAISE EXCEPTION 'fortuna_settlement_manual_exceeds_real_pending_balance';
      END IF;

      v_allocations := v_allocations || jsonb_build_array(
        jsonb_build_object('obligation_id', v_item.obligation_id, 'amount_minor', v_item.amount_minor)
      );
      v_allocated := v_allocated + v_item.amount_minor;
      v_left := v_left - v_item.amount_minor;
    END LOOP;
  END IF;

  IF v_allocated > p_total_amount_minor THEN
    RAISE EXCEPTION 'fortuna_settlement_allocations_exceed_cash_amount';
  END IF;

  v_overage := p_total_amount_minor - v_allocated;
  IF v_overage > 0 AND NOT COALESCE(p_confirm_overage, false) THEN
    RAISE EXCEPTION 'fortuna_overage_confirmation_required';
  END IF;

  INSERT INTO fortuna_private.financial_events (
    book_id, contact_id, currency_code, event_type, total_amount_minor, actor_user_id
  )
  VALUES (
    p_book_id, p_contact_id, p_currency_code, p_flow, p_total_amount_minor, p_actor_user_id
  )
  RETURNING id INTO v_event_id;

  IF p_fail_after = 'after_event' THEN
    RAISE EXCEPTION 'fortuna_settlement_test_failpoint: after_event';
  END IF;

  FOR v_item IN
    SELECT item.obligation_id, item.amount_minor
      FROM jsonb_to_recordset(v_allocations)
        AS item(obligation_id uuid, amount_minor bigint)
  LOOP
    INSERT INTO fortuna_private.financial_allocations (
      book_id, event_id, obligation_id, contact_id, currency_code, amount_minor
    )
    VALUES (
      p_book_id, v_event_id, v_item.obligation_id, p_contact_id, p_currency_code, v_item.amount_minor
    );

    INSERT INTO fortuna_private.financial_ledger_entries (
      book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor
    )
    VALUES (
      p_book_id, v_event_id, p_contact_id, p_currency_code,
      v_item.obligation_id, p_flow, v_cash_sign * v_item.amount_minor
    );
  END LOOP;

  IF p_fail_after = 'after_allocations' THEN
    RAISE EXCEPTION 'fortuna_settlement_test_failpoint: after_allocations';
  END IF;

  IF v_overage > 0 THEN
    INSERT INTO fortuna_private.financial_obligations (
      book_id, contact_id, currency_code, direction, principal_minor, description, created_by
    )
    VALUES (
      p_book_id,
      p_contact_id,
      p_currency_code,
      CASE WHEN p_flow = 'cash_received' THEN 'payable' ELSE 'receivable' END,
      v_overage,
      'Confirmed overage from settlement event ' || v_event_id::text,
      p_actor_user_id
    )
    RETURNING id INTO v_overage_obligation_id;

    IF p_fail_after = 'after_overage_obligation' THEN
      RAISE EXCEPTION 'fortuna_settlement_test_failpoint: after_overage_obligation';
    END IF;

    INSERT INTO fortuna_private.financial_ledger_entries (
      book_id, event_id, contact_id, currency_code, obligation_id, entry_kind, signed_minor
    )
    VALUES (
      p_book_id, v_event_id, p_contact_id, p_currency_code,
      v_overage_obligation_id, p_flow, v_cash_sign * v_overage
    );
  END IF;

  IF p_fail_after = 'after_ledger' THEN
    RAISE EXCEPTION 'fortuna_settlement_test_failpoint: after_ledger';
  END IF;

  SELECT COALESCE(sum(signed_minor), 0)::bigint
    INTO v_written_total
    FROM fortuna_private.financial_ledger_entries
   WHERE book_id = p_book_id
     AND event_id = v_event_id;

  IF v_written_total <> v_cash_sign * p_total_amount_minor THEN
    RAISE EXCEPTION 'fortuna_settlement_ledger_does_not_reconcile_to_cash_total';
  END IF;

  INSERT INTO fortuna_private.financial_audit (
    book_id, event_id, actor_user_id, action, details
  )
  VALUES (
    p_book_id,
    v_event_id,
    p_actor_user_id,
    p_flow,
    jsonb_build_object(
      'mode', p_mode,
      'allocated_minor', v_allocated,
      'overage_minor', v_overage,
      'confirmed_overage', COALESCE(p_confirm_overage, false)
    )
  );

  IF p_fail_after = 'after_audit' THEN
    RAISE EXCEPTION 'fortuna_settlement_test_failpoint: after_audit';
  END IF;

  v_response := jsonb_build_object(
    'event_id', v_event_id,
    'flow', p_flow,
    'mode', p_mode,
    'total_minor', p_total_amount_minor,
    'allocated_minor', v_allocated,
    'overage_minor', v_overage,
    'allocations', v_allocations,
    'overage_obligation_id', v_overage_obligation_id
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
    RAISE EXCEPTION 'fortuna_settlement_test_failpoint: after_idempotency_commit';
  END IF;

  RETURN v_response;
END;
$fortuna_settlement_test$;

REVOKE ALL ON FUNCTION fortuna_private.test_commit_settlement_atomic(
  uuid, uuid, text, uuid, text, text, text, text, bigint, jsonb, boolean, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fortuna_private.test_commit_settlement_atomic(
  uuid, uuid, text, uuid, text, text, text, text, bigint, jsonb, boolean, text
) TO service_role;
