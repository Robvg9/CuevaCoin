-- FORTUNA owner-only settlement preview/confirm prototype for isolated tests ONLY.
-- NOT a production migration. Do not apply to hosted Supabase.
-- Depends on fortuna_v1_schema_prototype.sql and
-- fortuna_v1_owner_api_operations_prototype.sql.
--
-- Public RPC wrappers are SECURITY INVOKER. Owner-facing private facades are
-- SECURITY DEFINER with a fixed search_path and derive actor/book from auth.uid().
-- The internal planning function is not executable by anon/authenticated.

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

-- Public API surface. Flow is fixed per endpoint, not supplied as identity/authority.
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

-- No direct table grants are added. fortuna_private remains unexposed.
