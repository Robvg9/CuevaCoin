-- FORTUNA V170: import the complete financial trail of CuevaCoin-only-to-FORTUNA profiles.
-- The source ledger remains untouched. The synthetic opening-balance event is replaced
-- by immutable legacy events plus explicit balance-snapshot reconciliation entries.
BEGIN;

CREATE TABLE IF NOT EXISTS fortuna_private.financial_profile_migrations (
  book_id uuid NOT NULL REFERENCES fortuna_private.financial_books(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL,
  source_transaction_count integer NOT NULL CHECK (source_transaction_count >= 0),
  source_withdrawal_count integer NOT NULL CHECK (source_withdrawal_count >= 0),
  source_audit_count integer NOT NULL CHECK (source_audit_count >= 0),
  source_notification_count integer NOT NULL CHECK (source_notification_count >= 0),
  reconciliation_count integer NOT NULL CHECK (reconciliation_count >= 0),
  source_balance_minor bigint NOT NULL CHECK (source_balance_minor >= 0),
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  completed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, profile_id),
  FOREIGN KEY (book_id, contact_id)
    REFERENCES fortuna_private.financial_contacts(book_id, id) ON DELETE RESTRICT
);

ALTER TABLE fortuna_private.financial_profile_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE fortuna_private.financial_profile_migrations FROM PUBLIC, anon, authenticated;

ALTER TABLE fortuna_private.financial_events
  DROP CONSTRAINT IF EXISTS financial_events_event_type_check;
ALTER TABLE fortuna_private.financial_events
  ADD CONSTRAINT financial_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'obligation_opened'::text, 'cash_received'::text, 'cash_paid'::text,
    'compensation'::text, 'reversal'::text, 'adjustment'::text, 'legacy_history'::text
  ]));

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_preview_profile_history_migration(
  p_contact_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_book_id uuid;
  v_profile_id uuid;
  v_balance numeric;
  v_is_dependent boolean;
  v_profile_state text;
  v_contact_name text;
  v_balance_minor bigint;
  v_final_snapshot numeric;
  v_transaction_count integer := 0;
  v_invalid_transaction_count integer := 0;
  v_withdrawal_count integer := 0;
  v_pending_withdrawal_count integer := 0;
  v_audit_count integer := 0;
  v_notification_count integer := 0;
  v_obligation_count integer := 0;
  v_opening_event_count integer := 0;
  v_event_count integer := 0;
  v_ledger_entry_count integer := 0;
  v_migrated boolean := false;
  v_gaps jsonb := '[]'::jsonb;
  v_gap_count integer := 0;
  v_ready boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.perfiles p
     WHERE p.id = v_actor AND p.es_admin IS TRUE AND p.estado = 'activo'
  ) THEN
    RAISE EXCEPTION 'fortuna_owner_required' USING ERRCODE = '42501';
  END IF;

  v_book_id := fortuna_private.fortuna_get_current_book_id();
  IF v_book_id IS NULL OR p_contact_id IS NULL THEN
    RAISE EXCEPTION 'fortuna_profile_migration_contact_not_found';
  END IF;

  SELECT p.id, p.saldo, p.es_dependiente, p.estado, c.display_name
    INTO v_profile_id, v_balance, v_is_dependent, v_profile_state, v_contact_name
    FROM fortuna_private.financial_contacts c
    JOIN public.perfiles p ON p.id = c.linked_profile_id
   WHERE c.book_id = v_book_id AND c.id = p_contact_id;

  IF NOT FOUND OR v_profile_id IS NULL THEN
    RAISE EXCEPTION 'fortuna_profile_migration_requires_linked_profile';
  END IF;
  IF v_is_dependent IS TRUE THEN
    RAISE EXCEPTION 'fortuna_profile_migration_profile_is_dependent';
  END IF;
  IF v_profile_state IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'fortuna_profile_migration_profile_not_active';
  END IF;

  v_balance_minor := pg_catalog.round(v_balance * 100)::bigint;

  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE pg_catalog.round(t.cantidad * 100) <>
                 pg_catalog.round((t.saldo_despues - t.saldo_antes) * 100)
         )::integer
    INTO v_transaction_count, v_invalid_transaction_count
    FROM public.transacciones t
   WHERE t.usuario_id = v_profile_id;

  SELECT t.saldo_despues
    INTO v_final_snapshot
    FROM public.transacciones t
   WHERE t.usuario_id = v_profile_id
   ORDER BY t.creado_en DESC, t.id DESC
   LIMIT 1;

  WITH ordered AS (
    SELECT t.id, t.creado_en, t.saldo_antes,
           lag(t.saldo_despues) OVER (ORDER BY t.creado_en, t.id) AS previous_after
      FROM public.transacciones t
     WHERE t.usuario_id = v_profile_id
  ),
  gaps AS (
    SELECT id, creado_en, COALESCE(previous_after, 0)::numeric AS previous_balance,
           saldo_antes::numeric AS recorded_balance,
           (saldo_antes - COALESCE(previous_after, 0))::numeric AS delta
      FROM ordered
     WHERE saldo_antes IS DISTINCT FROM COALESCE(previous_after, 0)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'source_transaction_id', id,
             'occurred_at', creado_en,
             'previous_balance', previous_balance::text,
             'recorded_balance', recorded_balance::text,
             'delta', delta::text,
             'amount_minor', pg_catalog.abs(pg_catalog.round(delta * 100))::bigint::text
           ) ORDER BY creado_en, id
         ), '[]'::jsonb)
    INTO v_gaps
    FROM gaps;

  v_gap_count := pg_catalog.jsonb_array_length(v_gaps);

  SELECT count(*)::integer,
         count(*) FILTER (WHERE s.estado = 'pendiente')::integer
    INTO v_withdrawal_count, v_pending_withdrawal_count
    FROM public.solicitudes_retiro s
   WHERE s.usuario_id = v_profile_id;

  SELECT count(*)::integer INTO v_audit_count
    FROM public.auditoria a WHERE a.usuario_id = v_profile_id;
  SELECT count(*)::integer INTO v_notification_count
    FROM public.notificaciones n WHERE n.usuario_id = v_profile_id;

  SELECT count(*)::integer INTO v_obligation_count
    FROM fortuna_private.financial_obligations o
   WHERE o.book_id = v_book_id AND o.contact_id = p_contact_id;
  SELECT count(*)::integer INTO v_opening_event_count
    FROM fortuna_private.financial_events e
   WHERE e.book_id = v_book_id AND e.contact_id = p_contact_id
     AND e.event_type = 'obligation_opened';
  SELECT count(*)::integer INTO v_event_count
    FROM fortuna_private.financial_events e
   WHERE e.book_id = v_book_id AND e.contact_id = p_contact_id;
  SELECT count(*)::integer INTO v_ledger_entry_count
    FROM fortuna_private.financial_ledger_entries le
   WHERE le.book_id = v_book_id AND le.contact_id = p_contact_id;

  SELECT EXISTS (
    SELECT 1 FROM fortuna_private.financial_profile_migrations m
     WHERE m.book_id = v_book_id AND m.profile_id = v_profile_id
  ) INTO v_migrated;

  v_ready :=
    NOT v_migrated
    AND v_transaction_count > 0
    AND v_invalid_transaction_count = 0
    AND v_final_snapshot IS NOT NULL
    AND pg_catalog.round(v_final_snapshot * 100)::bigint = v_balance_minor
    AND v_balance_minor >= 0
    AND v_pending_withdrawal_count = 0
    AND v_obligation_count = 1
    AND v_opening_event_count = 1
    AND v_event_count = 1
    AND v_ledger_entry_count = 1
    AND EXISTS (
      SELECT 1 FROM fortuna_private.financial_obligations o
       WHERE o.book_id = v_book_id AND o.contact_id = p_contact_id
         AND o.currency_code = 'CUP' AND o.direction = 'payable'
         AND o.description = 'Saldo CuevaCoin pendiente de liquidar'
         AND o.principal_minor = v_balance_minor
    );

  RETURN pg_catalog.jsonb_build_object(
    'contact_id', p_contact_id,
    'profile_id', v_profile_id,
    'display_name', v_contact_name,
    'ready', v_ready,
    'already_migrated', v_migrated,
    'dependent', v_is_dependent,
    'source_balance_minor', v_balance_minor::text,
    'final_snapshot_minor', CASE WHEN v_final_snapshot IS NULL THEN NULL
      ELSE pg_catalog.round(v_final_snapshot * 100)::bigint::text END,
    'transaction_count', v_transaction_count,
    'invalid_transaction_count', v_invalid_transaction_count,
    'withdrawal_request_count', v_withdrawal_count,
    'pending_withdrawal_count', v_pending_withdrawal_count,
    'audit_count', v_audit_count,
    'notification_count', v_notification_count,
    'reconciliation_count', v_gap_count,
    'reconciliation_gaps', v_gaps,
    'existing_obligation_count', v_obligation_count,
    'existing_event_count', v_event_count,
    'existing_ledger_entry_count', v_ledger_entry_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_migrate_profile_history(
  p_contact_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_book_id uuid;
  v_preview jsonb;
  v_profile_id uuid;
  v_profile_balance numeric;
  v_profile_name text;
  v_obligation_id uuid;
  v_opening_event_id uuid;
  v_tx record;
  v_request record;
  v_gap numeric;
  v_delta numeric;
  v_gap_minor bigint;
  v_delta_minor bigint;
  v_amount_minor bigint;
  v_expected_balance numeric := 0;
  v_principal_minor bigint := 0;
  v_current_ledger_minor bigint;
  v_transaction_count integer := 0;
  v_withdrawal_count integer := 0;
  v_audit_count integer := 0;
  v_notification_count integer := 0;
  v_reconciliation_count integer := 0;
  v_digest_payload text;
  v_digest text;
  v_event_id uuid;
  v_existing record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.perfiles p
     WHERE p.id = v_actor AND p.es_admin IS TRUE AND p.estado = 'activo'
  ) THEN
    RAISE EXCEPTION 'fortuna_owner_required' USING ERRCODE = '42501';
  END IF;

  v_book_id := fortuna_private.fortuna_get_current_book_id();
  IF v_book_id IS NULL OR p_contact_id IS NULL THEN
    RAISE EXCEPTION 'fortuna_profile_migration_contact_not_found';
  END IF;

  SELECT m.* INTO v_existing
    FROM fortuna_private.financial_profile_migrations m
   WHERE m.book_id = v_book_id
     AND m.profile_id = (
       SELECT c.linked_profile_id FROM fortuna_private.financial_contacts c
        WHERE c.book_id = v_book_id AND c.id = p_contact_id
     );
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true, 'already_migrated', true,
      'contact_id', p_contact_id, 'profile_id', v_existing.profile_id,
      'transaction_count', v_existing.source_transaction_count,
      'withdrawal_request_count', v_existing.source_withdrawal_count,
      'reconciliation_count', v_existing.reconciliation_count,
      'source_balance_minor', v_existing.source_balance_minor::text,
      'completed_at', v_existing.completed_at
    );
  END IF;

  PERFORM 1
    FROM fortuna_private.financial_contacts c
   WHERE c.book_id = v_book_id AND c.id = p_contact_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fortuna_profile_migration_contact_not_found'; END IF;

  v_preview := fortuna_private.fortuna_preview_profile_history_migration(p_contact_id);
  IF v_preview->>'ready' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'fortuna_profile_migration_not_ready';
  END IF;

  v_profile_id := (v_preview->>'profile_id')::uuid;
  SELECT p.saldo, COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', p.nombre, p.apellido)), ''), p.usuario)
    INTO v_profile_balance, v_profile_name
    FROM public.perfiles p
   WHERE p.id = v_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fortuna_profile_migration_profile_not_found'; END IF;

  SELECT o.id INTO v_obligation_id
    FROM fortuna_private.financial_obligations o
   WHERE o.book_id = v_book_id AND o.contact_id = p_contact_id
     AND o.currency_code = 'CUP' AND o.direction = 'payable'
     AND o.description = 'Saldo CuevaCoin pendiente de liquidar'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fortuna_profile_migration_opening_obligation_missing'; END IF;

  SELECT e.id INTO v_opening_event_id
    FROM fortuna_private.financial_events e
    JOIN fortuna_private.financial_audit a
      ON a.book_id = e.book_id AND a.event_id = e.id
   WHERE e.book_id = v_book_id AND e.contact_id = p_contact_id
     AND e.event_type = 'obligation_opened'
     AND a.action = 'obligation_opened'
     AND a.details->>'obligation_id' = v_obligation_id::text
   ORDER BY e.created_at, e.id
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'fortuna_profile_migration_opening_event_missing'; END IF;

  -- Replace only the synthetic opening-balance snapshot created by profile linking.
  -- The source transactions below become the actual ledger history.
  DELETE FROM fortuna_private.financial_audit
   WHERE book_id = v_book_id AND event_id = v_opening_event_id;
  DELETE FROM fortuna_private.financial_ledger_entries
   WHERE book_id = v_book_id AND event_id = v_opening_event_id;
  DELETE FROM fortuna_private.financial_events
   WHERE book_id = v_book_id AND id = v_opening_event_id;

  FOR v_tx IN
    SELECT t.* FROM public.transacciones t
     WHERE t.usuario_id = v_profile_id
     ORDER BY t.creado_en, t.id
  LOOP
    v_gap := v_tx.saldo_antes - v_expected_balance;
    IF v_gap <> 0 THEN
      v_gap_minor := pg_catalog.round(v_gap * 100)::bigint;
      v_amount_minor := pg_catalog.abs(v_gap_minor);
      INSERT INTO fortuna_private.financial_events (
        book_id, contact_id, currency_code, event_type,
        total_amount_minor, actor_user_id, metadata, occurred_at
      ) VALUES (
        v_book_id, p_contact_id, 'CUP', 'legacy_history',
        v_amount_minor, v_actor,
        pg_catalog.jsonb_build_object(
          'source_system', 'CuevaCoin',
          'source_kind', 'balance_reconciliation',
          'source_profile_id', v_profile_id,
          'source_transaction_id', v_tx.id,
          'previous_snapshot', v_expected_balance::text,
          'recorded_balance_before', v_tx.saldo_antes::text,
          'delta_amount', v_gap::text,
          'explanation', 'Diferencia entre el saldo posterior anterior y el saldo_antes del movimiento original; se conserva como conciliación, no como pago.'
        ),
        v_tx.creado_en - interval '1 microsecond'
      ) RETURNING id INTO v_event_id;

      INSERT INTO fortuna_private.financial_ledger_entries (
        book_id, event_id, contact_id, currency_code,
        obligation_id, entry_kind, signed_minor, created_at
      ) VALUES (
        v_book_id, v_event_id, p_contact_id, 'CUP',
        v_obligation_id, 'adjustment', -v_gap_minor,
        v_tx.creado_en - interval '1 microsecond'
      );
      INSERT INTO fortuna_private.financial_audit (
        book_id, event_id, actor_user_id, action, details, created_at
      ) VALUES (
        v_book_id, v_event_id, v_actor, 'cuevacoin_balance_reconciliation_imported',
        pg_catalog.jsonb_build_object(
          'source_transaction_id', v_tx.id,
          'previous_snapshot', v_expected_balance::text,
          'recorded_balance_before', v_tx.saldo_antes::text,
          'delta_amount', v_gap::text
        ),
        v_tx.creado_en - interval '1 microsecond'
      );
      v_principal_minor := v_principal_minor + GREATEST(v_gap_minor, 0);
      v_reconciliation_count := v_reconciliation_count + 1;
      v_expected_balance := v_tx.saldo_antes;
    END IF;

    v_delta := v_tx.saldo_despues - v_tx.saldo_antes;
    v_delta_minor := pg_catalog.round(v_delta * 100)::bigint;
    IF v_delta_minor <> 0 THEN
      v_amount_minor := pg_catalog.abs(v_delta_minor);
      INSERT INTO fortuna_private.financial_events (
        book_id, contact_id, currency_code, event_type,
        total_amount_minor, actor_user_id, metadata, occurred_at
      ) VALUES (
        v_book_id, p_contact_id, 'CUP', 'legacy_history',
        v_amount_minor, v_actor,
        pg_catalog.jsonb_build_object(
          'source_system', 'CuevaCoin',
          'source_kind', 'transaction',
          'source_table', 'public.transacciones',
          'source_record_id', v_tx.id,
          'source_profile_id', v_profile_id,
          'original_type', v_tx.tipo,
          'original_amount', v_tx.cantidad::text,
          'original_balance_before', v_tx.saldo_antes::text,
          'original_balance_after', v_tx.saldo_despues::text,
          'original_motive', v_tx.motivo,
          'original_admin_id', v_tx.admin_id,
          'original_counterparty_id', v_tx.contraparte_id,
          'original_transfer_id', v_tx.transferencia_id,
          'original_created_at', v_tx.creado_en
        ),
        v_tx.creado_en
      ) RETURNING id INTO v_event_id;

      INSERT INTO fortuna_private.financial_ledger_entries (
        book_id, event_id, contact_id, currency_code,
        obligation_id, entry_kind, signed_minor, created_at
      ) VALUES (
        v_book_id, v_event_id, p_contact_id, 'CUP',
        v_obligation_id, 'adjustment', -v_delta_minor, v_tx.creado_en
      );
      INSERT INTO fortuna_private.financial_audit (
        book_id, event_id, actor_user_id, action, details, created_at
      ) VALUES (
        v_book_id, v_event_id, v_actor, 'cuevacoin_transaction_imported',
        pg_catalog.jsonb_build_object(
          'source_transaction_id', v_tx.id,
          'original_type', v_tx.tipo,
          'original_amount', v_tx.cantidad::text,
          'original_motive', v_tx.motivo,
          'original_balance_before', v_tx.saldo_antes::text,
          'original_balance_after', v_tx.saldo_despues::text
        ),
        v_tx.creado_en
      );
      v_principal_minor := v_principal_minor + GREATEST(v_delta_minor, 0);
    END IF;
    v_expected_balance := v_tx.saldo_despues;
    v_transaction_count := v_transaction_count + 1;
  END LOOP;

  IF pg_catalog.round(v_expected_balance * 100)::bigint <>
     pg_catalog.round(v_profile_balance * 100)::bigint THEN
    RAISE EXCEPTION 'fortuna_profile_migration_final_balance_mismatch';
  END IF;
  IF v_principal_minor <= 0 THEN
    RAISE EXCEPTION 'fortuna_profile_migration_principal_invalid';
  END IF;

  UPDATE fortuna_private.financial_obligations
     SET principal_minor = v_principal_minor,
         description = 'Historial migrado desde CuevaCoin — saldo conciliado',
         opened_at = (
           SELECT min(t.creado_en) FROM public.transacciones t
            WHERE t.usuario_id = v_profile_id
         )
   WHERE book_id = v_book_id AND id = v_obligation_id;

  FOR v_request IN
    SELECT s.* FROM public.solicitudes_retiro s
     WHERE s.usuario_id = v_profile_id
     ORDER BY s.creado_en, s.id
  LOOP
    v_amount_minor := pg_catalog.round(pg_catalog.abs(v_request.cantidad) * 100)::bigint;
    INSERT INTO fortuna_private.financial_events (
      book_id, contact_id, currency_code, event_type,
      total_amount_minor, actor_user_id, metadata, occurred_at
    ) VALUES (
      v_book_id, p_contact_id, 'CUP', 'legacy_history',
      v_amount_minor, v_actor,
      pg_catalog.jsonb_build_object(
        'source_system', 'CuevaCoin',
        'source_kind', 'withdrawal_request',
        'source_table', 'public.solicitudes_retiro',
        'source_record_id', v_request.id,
        'original_amount', v_request.cantidad::text,
        'original_status', v_request.estado,
        'original_motive', v_request.motivo,
        'original_created_at', v_request.creado_en,
        'original_resolved_at', v_request.resuelto_en,
        'original_resolved_by', v_request.resuelto_por,
        'affects_balance', false
      ),
      v_request.creado_en
    ) RETURNING id INTO v_event_id;
    INSERT INTO fortuna_private.financial_audit (
      book_id, event_id, actor_user_id, action, details, created_at
    ) VALUES (
      v_book_id, v_event_id, v_actor, 'cuevacoin_withdrawal_request_imported',
      pg_catalog.jsonb_build_object(
        'source_request_id', v_request.id,
        'status', v_request.estado,
        'amount', v_request.cantidad::text,
        'motive', v_request.motivo,
        'affects_balance', false
      ),
      v_request.creado_en
    );
    v_withdrawal_count := v_withdrawal_count + 1;
  END LOOP;

  -- Preserve account-level audit and notification history as private audit evidence.
  INSERT INTO fortuna_private.financial_audit (
    book_id, event_id, actor_user_id, action, details, created_at
  )
  SELECT v_book_id, NULL, v_actor, 'cuevacoin_account_audit_imported',
         pg_catalog.jsonb_build_object(
           'source_system', 'CuevaCoin', 'source_table', 'public.auditoria',
           'source_record_id', a.id, 'usuario_nombre', a.usuario_nombre,
           'accion', a.accion, 'ip', a.ip, 'dispositivo', a.dispositivo
         ), a.creado_en
    FROM public.auditoria a
   WHERE a.usuario_id = v_profile_id;
  GET DIAGNOSTICS v_audit_count = ROW_COUNT;

  INSERT INTO fortuna_private.financial_audit (
    book_id, event_id, actor_user_id, action, details, created_at
  )
  SELECT v_book_id, NULL, v_actor, 'cuevacoin_notification_imported',
         pg_catalog.jsonb_build_object(
           'source_system', 'CuevaCoin', 'source_table', 'public.notificaciones',
           'source_record_id', n.id, 'message', n.mensaje,
           'event_type', n.tipo_evento, 'read', n.leida
         ), n.creado_en
    FROM public.notificaciones n
   WHERE n.usuario_id = v_profile_id;
  GET DIAGNOSTICS v_notification_count = ROW_COUNT;

  INSERT INTO fortuna_private.financial_audit (
    book_id, event_id, actor_user_id, action, details, created_at
  )
  SELECT v_book_id, NULL, v_actor, 'cuevacoin_balance_adjustment_idempotency_imported',
         pg_catalog.jsonb_build_object('source_system', 'CuevaCoin', 'source_table', 'public.admin_ajustes_saldo_idempotencia', 'source_record', pg_catalog.to_jsonb(a)),
         a.creado_en
    FROM public.admin_ajustes_saldo_idempotencia a
   WHERE a.usuario_id = v_profile_id;

  INSERT INTO fortuna_private.financial_audit (
    book_id, event_id, actor_user_id, action, details, created_at
  )
  SELECT v_book_id, NULL, v_actor, 'cuevacoin_salary_batch_idempotency_imported',
         pg_catalog.jsonb_build_object('source_system', 'CuevaCoin', 'source_table', 'public.admin_pagos_salario_idempotencia', 'source_record', pg_catalog.to_jsonb(b)),
         COALESCE(b.completado_en, b.creado_en)
    FROM public.admin_pagos_salario_idempotencia b
   WHERE EXISTS (
     SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(b.payload, '[]'::jsonb)) item
      WHERE item->>'usuario_id' = v_profile_id::text
   );

  v_digest_payload :=
    COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.creado_en, t.id)::text
        FROM public.transacciones t WHERE t.usuario_id = v_profile_id
    ), '[]')
    || COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) ORDER BY s.creado_en, s.id)::text
        FROM public.solicitudes_retiro s WHERE s.usuario_id = v_profile_id
    ), '[]');
  v_digest := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_digest_payload, 'UTF8')), 'hex'
  );

  SELECT COALESCE(pg_catalog.sum(le.signed_minor), 0)::bigint
    INTO v_current_ledger_minor
    FROM fortuna_private.financial_ledger_entries le
   WHERE le.book_id = v_book_id AND le.obligation_id = v_obligation_id;
  IF v_current_ledger_minor <> -pg_catalog.round(v_profile_balance * 100)::bigint THEN
    RAISE EXCEPTION 'fortuna_profile_migration_ledger_reconciliation_failed';
  END IF;

  INSERT INTO fortuna_private.financial_profile_migrations (
    book_id, profile_id, contact_id, source_transaction_count,
    source_withdrawal_count, source_audit_count, source_notification_count,
    reconciliation_count, source_balance_minor, source_digest, completed_by
  ) VALUES (
    v_book_id, v_profile_id, p_contact_id, v_transaction_count,
    v_withdrawal_count, v_audit_count, v_notification_count,
    v_reconciliation_count, pg_catalog.round(v_profile_balance * 100)::bigint,
    v_digest, v_actor
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'already_migrated', false,
    'contact_id', p_contact_id,
    'profile_id', v_profile_id,
    'display_name', v_profile_name,
    'transaction_count', v_transaction_count,
    'withdrawal_request_count', v_withdrawal_count,
    'audit_count', v_audit_count,
    'notification_count', v_notification_count,
    'reconciliation_count', v_reconciliation_count,
    'source_balance_minor', pg_catalog.round(v_profile_balance * 100)::bigint::text,
    'ledger_balance_minor', (-v_current_ledger_minor)::text,
    'source_digest', v_digest
  );
END;
$function$;

CREATE OR REPLACE FUNCTION api.preview_fortuna_profile_history_migration(p_contact_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT fortuna_private.fortuna_preview_profile_history_migration($1);
$function$;

CREATE OR REPLACE FUNCTION api.migrate_fortuna_profile_history(p_contact_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT fortuna_private.fortuna_migrate_profile_history($1);
$function$;

REVOKE ALL ON FUNCTION fortuna_private.fortuna_preview_profile_history_migration(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_preview_profile_history_migration(uuid) TO authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_migrate_profile_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_migrate_profile_history(uuid) TO authenticated;
REVOKE ALL ON FUNCTION api.preview_fortuna_profile_history_migration(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.preview_fortuna_profile_history_migration(uuid) TO authenticated;
REVOKE ALL ON FUNCTION api.migrate_fortuna_profile_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.migrate_fortuna_profile_history(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_list_activity(
  p_contact_id uuid,
  p_limit integer DEFAULT 50,
  p_before_occurred_at timestamptz DEFAULT NULL,
  p_before_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_book_id uuid;
  v_response jsonb;
BEGIN
  IF p_contact_id IS NULL THEN RAISE EXCEPTION 'fortuna_activity_contact_invalid'; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'fortuna_activity_limit_invalid'; END IF;
  IF (p_before_occurred_at IS NULL) <> (p_before_event_id IS NULL) THEN
    RAISE EXCEPTION 'fortuna_activity_cursor_invalid';
  END IF;
  v_book_id := fortuna_private.fortuna_get_current_book_id();
  IF v_book_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('items', '[]'::jsonb, 'has_more', false, 'next_cursor', NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fortuna_private.financial_contacts c
     WHERE c.book_id = v_book_id AND c.id = p_contact_id
  ) THEN RAISE EXCEPTION 'fortuna_activity_resource_not_found'; END IF;

  WITH activity_rows AS MATERIALIZED (
    SELECT e.id, e.event_type, e.currency_code, e.total_amount_minor,
           e.occurred_at, e.reversal_reason, e.metadata,
           (SELECT a.action FROM fortuna_private.financial_audit a
             WHERE a.book_id = e.book_id AND a.event_id = e.id
             ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS audit_action,
           COALESCE((
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'obligation_id', o.id,
               'description', o.description,
               'amount_minor', pg_catalog.abs(le.signed_minor)::text,
               'signed_minor', le.signed_minor::text,
               'entry_kind', le.entry_kind
             ) ORDER BY le.created_at, le.id)
               FROM fortuna_private.financial_ledger_entries le
               JOIN fortuna_private.financial_obligations o
                 ON o.book_id = le.book_id AND o.id = le.obligation_id
              WHERE le.book_id = e.book_id AND le.event_id = e.id
                AND le.contact_id = e.contact_id AND le.currency_code = e.currency_code
           ), '[]'::jsonb) AS ledger_entries
      FROM fortuna_private.financial_events e
     WHERE e.book_id = v_book_id AND e.contact_id = p_contact_id
       AND (p_before_occurred_at IS NULL
         OR (e.occurred_at, e.id) < (p_before_occurred_at, p_before_event_id))
     ORDER BY e.occurred_at DESC, e.id DESC
     LIMIT p_limit + 1
  ),
  page AS (
    SELECT * FROM activity_rows
     ORDER BY occurred_at DESC, id DESC
     LIMIT p_limit
  )
  SELECT pg_catalog.jsonb_build_object(
    'items', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'event_id', p.id, 'event_type', p.event_type,
        'currency', p.currency_code, 'total_amount_minor', p.total_amount_minor::text,
        'occurred_at', p.occurred_at, 'reversal_reason', p.reversal_reason,
        'audit_action', p.audit_action, 'metadata', p.metadata,
        'ledger_entries', p.ledger_entries
      ) ORDER BY p.occurred_at DESC, p.id DESC) FROM page p
    ), '[]'::jsonb),
    'has_more', (SELECT pg_catalog.count(*) > p_limit FROM activity_rows),
    'next_cursor', CASE WHEN (SELECT pg_catalog.count(*) > p_limit FROM activity_rows) THEN (
      SELECT pg_catalog.jsonb_build_object('occurred_at', p.occurred_at, 'event_id', p.id)
        FROM page p ORDER BY p.occurred_at ASC, p.id ASC LIMIT 1
    ) ELSE NULL END
  ) INTO v_response;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_list_contacts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_book_id uuid;
  v_response jsonb;
BEGIN
  v_book_id := fortuna_private.fortuna_get_current_book_id();
  IF v_book_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  WITH obligation_balances AS (
    SELECT o.id AS obligation_id, o.contact_id, o.currency_code, o.direction,
           COALESCE(pg_catalog.sum(l.signed_minor), 0)::bigint AS signed_minor
      FROM fortuna_private.financial_obligations o
      LEFT JOIN fortuna_private.financial_ledger_entries l
        ON l.book_id = o.book_id AND l.obligation_id = o.id
     WHERE o.book_id = v_book_id
     GROUP BY o.id, o.contact_id, o.currency_code, o.direction
  ),
  positions AS (
    SELECT b.contact_id, b.currency_code,
           pg_catalog.sum(CASE WHEN b.direction = 'receivable' THEN b.signed_minor ELSE 0 END)::bigint AS gross_receivable_minor,
           pg_catalog.sum(CASE WHEN b.direction = 'payable' THEN -b.signed_minor ELSE 0 END)::bigint AS gross_payable_minor
      FROM obligation_balances b
     GROUP BY b.contact_id, b.currency_code
    HAVING pg_catalog.sum(CASE WHEN b.direction = 'receivable' THEN b.signed_minor ELSE 0 END) > 0
        OR pg_catalog.sum(CASE WHEN b.direction = 'payable' THEN -b.signed_minor ELSE 0 END) > 0
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'contact_id', c.id,
    'display_name', c.display_name,
    'phone', c.phone,
    'notes', c.notes,
    'linked_profile_id', c.linked_profile_id,
    'is_dependent', p.es_dependiente,
    'currencies', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'currency', pos.currency_code,
        'te_debe_minor', pos.gross_receivable_minor::text,
        'le_debes_minor', pos.gross_payable_minor::text,
        'position_type', CASE
          WHEN pos.gross_receivable_minor > 0 AND pos.gross_payable_minor > 0 THEN 'mixed'
          WHEN pos.gross_receivable_minor > 0 THEN 'receivable' ELSE 'payable' END
      ) ORDER BY pos.currency_code)
      FROM positions pos WHERE pos.contact_id = c.id
    ), '[]'::jsonb)
  ) ORDER BY pg_catalog.lower(c.display_name), c.id), '[]'::jsonb)
    INTO v_response
    FROM fortuna_private.financial_contacts c
    LEFT JOIN public.perfiles p ON p.id = c.linked_profile_id
   WHERE c.book_id = v_book_id;
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION fortuna_private.fortuna_list_activity(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_list_activity(uuid, integer, timestamptz, uuid) TO authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_list_contacts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_list_contacts() TO authenticated;

-- CuevaCoin is an employee ledger: private-only FORTUNA profiles cannot request
-- withdrawals, transfer, receive transfers, or be resolved as recipients.
CREATE OR REPLACE FUNCTION public.solicitar_retiro(
  p_cantidad numeric,
  p_idempotency_key text,
  p_motivo text
)
RETURNS TABLE(solicitud_id uuid, nuevo_saldo numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  u uuid := auth.uid();
  s numeric;
  est text;
  adm boolean;
  dep boolean;
  sid uuid;
  eu uuid;
  ec numeric;
  em text;
  ee text;
  k text := NULLIF(trim(p_idempotency_key), '');
  sb numeric;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;
  SELECT saldo, estado, es_admin, es_dependiente INTO s, est, adm, dep
    FROM public.perfiles WHERE id = u FOR UPDATE;
  IF s IS NULL THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;
  IF adm THEN RAISE EXCEPTION 'Un admin no solicita retiros'; END IF;
  IF dep IS DISTINCT FROM true THEN RAISE EXCEPTION 'cuenta_solo_fortuna'; END IF;
  IF est IS DISTINCT FROM 'activo' THEN RAISE EXCEPTION 'Tu cuenta está desactivada'; END IF;
  IF k IS NOT NULL THEN
    SELECT id, usuario_id, cantidad, motivo, estado INTO sid, eu, ec, em, ee
      FROM public.solicitudes_retiro WHERE idempotency_key = k LIMIT 1;
    IF sid IS NOT NULL THEN
      IF eu <> u OR ec IS DISTINCT FROM p_cantidad OR COALESCE(em,'') IS DISTINCT FROM COALESCE(p_motivo,'') THEN
        RAISE EXCEPTION 'idempotency_key_conflict';
      END IF;
      IF ee = 'pendiente' THEN RETURN QUERY SELECT sid, s; RETURN; END IF;
      RAISE EXCEPTION 'idempotency_key_replay';
    END IF;
  END IF;
  SELECT id INTO sid FROM public.solicitudes_retiro
   WHERE usuario_id = u AND estado = 'pendiente' ORDER BY creado_en DESC LIMIT 1;
  IF sid IS NOT NULL THEN
    IF k IS NULL THEN RETURN QUERY SELECT sid, s; RETURN; END IF;
    RAISE EXCEPTION 'retiro_pendiente_existente';
  END IF;
  IF p_cantidad > s THEN RAISE EXCEPTION 'Saldo insuficiente'; END IF;
  sb := s;
  INSERT INTO public.solicitudes_retiro(usuario_id,cantidad,motivo,estado,idempotency_key)
  VALUES(u,p_cantidad,p_motivo,'pendiente',k) RETURNING id INTO sid;
  PERFORM set_config('cuevacoin.trusted_balance_write','1',true);
  UPDATE public.perfiles SET saldo=saldo-p_cantidad WHERE id=u RETURNING saldo INTO s;
  INSERT INTO public.transacciones(usuario_id,admin_id,tipo,cantidad,saldo_antes,saldo_despues,motivo)
  VALUES(u,NULL,'retiro',-p_cantidad,sb,s,'Reserva de retiro pendiente — solicitud '||sid::text);
  RETURN QUERY SELECT sid,s;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolver_retiro(
  p_solicitud_id uuid,
  p_accion text
)
RETURNS TABLE(resultado text, nuevo_saldo numeric, usuario_id uuid, usuario_nombre text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  adm boolean;
  admin_estado text;
  an text;
  r record;
  p record;
  sn numeric;
  sa numeric;
BEGIN
  SELECT es_admin, estado, COALESCE(nombre, usuario)
    INTO adm, admin_estado, an
    FROM public.perfiles WHERE id = auth.uid();
  IF adm IS NOT TRUE OR admin_estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'Solo un administrador activo puede resolver retiros';
  END IF;
  IF p_accion NOT IN ('aprobar', 'rechazar') THEN RAISE EXCEPTION 'Acción inválida'; END IF;
  SELECT * INTO r FROM public.solicitudes_retiro WHERE id = p_solicitud_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  IF r.estado <> 'pendiente' THEN RAISE EXCEPTION 'ya_no_pendiente'; END IF;
  SELECT id, saldo, nombre, usuario, es_dependiente
    INTO p FROM public.perfiles WHERE id = r.usuario_id FOR UPDATE;
  IF p IS NULL THEN RAISE EXCEPTION 'Usuario del retiro no encontrado'; END IF;
  IF p.es_dependiente IS DISTINCT FROM true THEN RAISE EXCEPTION 'cuenta_solo_fortuna'; END IF;

  IF p_accion = 'aprobar' THEN
    UPDATE public.solicitudes_retiro
       SET estado = 'aprobado', resuelto_por = auth.uid(), resuelto_en = now()
     WHERE id = p_solicitud_id;
    sn := p.saldo;
    INSERT INTO public.notificaciones(usuario_id, mensaje, leida, tipo_evento)
    VALUES (r.usuario_id, 'Tu solicitud de retiro de $' || trim(to_char(r.cantidad, 'FM999999990.00')) || ' ha sido aprobada.', false, 'retiro_aprobado');
    INSERT INTO public.auditoria(usuario_id, usuario_nombre, accion)
    VALUES (auth.uid(), an, 'Aprobó retiro de $' || trim(to_char(r.cantidad, 'FM999999990.00')) || ' para ' || COALESCE(p.nombre, p.usuario));
    RETURN QUERY SELECT 'aprobado'::text, sn, r.usuario_id, COALESCE(p.nombre, p.usuario);
    RETURN;
  END IF;

  sa := p.saldo;
  UPDATE public.solicitudes_retiro
     SET estado = 'rechazado', resuelto_por = auth.uid(), resuelto_en = now()
   WHERE id = p_solicitud_id;
  PERFORM set_config('cuevacoin.trusted_balance_write','1',true);
  UPDATE public.perfiles SET saldo = saldo + r.cantidad
   WHERE id = r.usuario_id RETURNING saldo INTO sn;
  INSERT INTO public.transacciones(usuario_id, admin_id, tipo, cantidad, saldo_antes, saldo_despues, motivo)
  VALUES (r.usuario_id, auth.uid(), 'retiro', r.cantidad, sa, sn,
          'Reembolso de retiro rechazado — solicitud ' || r.id::text);
  INSERT INTO public.notificaciones(usuario_id, mensaje, leida, tipo_evento)
  VALUES (r.usuario_id, 'Tu solicitud de retiro de $' || trim(to_char(r.cantidad, 'FM999999990.00')) || ' ha sido rechazada. El monto vuelve a tu saldo disponible.', false, 'retiro_rechazado');
  INSERT INTO public.auditoria(usuario_id, usuario_nombre, accion)
  VALUES (auth.uid(), an, 'Rechazó retiro de $' || trim(to_char(r.cantidad, 'FM999999990.00')) || ' para ' || COALESCE(p.nombre, p.usuario));
  RETURN QUERY SELECT 'rechazado'::text, sn, r.usuario_id, COALESCE(p.nombre, p.usuario);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolver_retiro(
  p_solicitud_id uuid,
  p_aprobar boolean
)
RETURNS TABLE(usuario_id uuid, nombre text, usuario_nombre_usuario text, nuevo_saldo numeric, cantidad numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_admin boolean;
  v_admin_estado text;
  v_solicitud record;
  v_saldo numeric;
  v_nombre text;
  v_usuario text;
  v_dep boolean;
BEGIN
  SELECT es_admin, estado INTO v_admin, v_admin_estado
    FROM public.perfiles WHERE id = v_admin_id;
  IF v_admin IS NOT TRUE OR v_admin_estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'Solo un administrador activo puede resolver retiros';
  END IF;
  SELECT * INTO v_solicitud FROM public.solicitudes_retiro
   WHERE id = p_solicitud_id AND estado = 'pendiente' FOR UPDATE;
  IF v_solicitud IS NULL THEN RAISE EXCEPTION 'Esta solicitud ya no está pendiente'; END IF;
  SELECT saldo, nombre, usuario, es_dependiente
    INTO v_saldo, v_nombre, v_usuario, v_dep
    FROM public.perfiles WHERE id = v_solicitud.usuario_id FOR UPDATE;
  IF v_dep IS DISTINCT FROM true THEN RAISE EXCEPTION 'cuenta_solo_fortuna'; END IF;

  IF p_aprobar THEN
    UPDATE public.solicitudes_retiro SET estado='aprobado', resuelto_por=v_admin_id, resuelto_en=now()
     WHERE id=p_solicitud_id;
    INSERT INTO public.transacciones(usuario_id,admin_id,tipo,cantidad,saldo_antes,saldo_despues,motivo)
    VALUES(v_solicitud.usuario_id,v_admin_id,'retiro',-v_solicitud.cantidad,v_saldo,v_saldo,'Retiro aprobado por admin');
    INSERT INTO public.notificaciones(usuario_id,mensaje,leida,tipo_evento)
    VALUES(v_solicitud.usuario_id,'Tu solicitud de retiro de $'||trim(to_char(v_solicitud.cantidad,'FM999999990.00'))||' ha sido aprobada.',false,'retiro_aprobado');
  ELSE
    PERFORM set_config('cuevacoin.trusted_balance_write','1',true);
    UPDATE public.perfiles SET saldo=saldo+v_solicitud.cantidad WHERE id=v_solicitud.usuario_id RETURNING saldo INTO v_saldo;
    UPDATE public.solicitudes_retiro SET estado='rechazado',resuelto_por=v_admin_id,resuelto_en=now()
     WHERE id=p_solicitud_id;
    INSERT INTO public.transacciones(usuario_id,admin_id,tipo,cantidad,saldo_antes,saldo_despues,motivo)
    VALUES(v_solicitud.usuario_id,v_admin_id,'retiro',v_solicitud.cantidad,v_saldo-v_solicitud.cantidad,v_saldo,
           'Reembolso de retiro rechazado — solicitud '||v_solicitud.id::text);
    INSERT INTO public.notificaciones(usuario_id,mensaje,leida,tipo_evento)
    VALUES(v_solicitud.usuario_id,'Tu solicitud de retiro de $'||trim(to_char(v_solicitud.cantidad,'FM999999990.00'))||' ha sido rechazada. El monto vuelve a tu saldo disponible.',false,'retiro_rechazado');
  END IF;
  RETURN QUERY SELECT v_solicitud.usuario_id,v_nombre,v_usuario,v_saldo,v_solicitud.cantidad;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolver_destinatario_transferencia_v2(p_identificador text)
RETURNS TABLE(id uuid, usuario text, nombre text, apellido text, estado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v text := NULLIF(trim(p_identificador), '');
  v_lc text;
  v_name_matches integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF v IS NULL THEN RAISE EXCEPTION 'Identificador requerido'; END IF;
  v_lc := lower(v);
  IF NOT EXISTS (
    SELECT 1 FROM public.perfiles p
     WHERE p.estado='activo' AND p.es_admin=false AND p.es_dependiente=true
       AND (lower(trim(p.usuario))=v_lc OR lower(trim(p.correo))=v_lc)
  ) THEN
    SELECT count(*) INTO v_name_matches FROM public.perfiles p
     WHERE p.estado='activo' AND p.es_admin=false AND p.es_dependiente=true
       AND lower(trim(p.nombre))=v_lc;
    IF v_name_matches > 1 THEN RAISE EXCEPTION 'Nombre ambiguo. Busca por usuario o correo electrónico.'; END IF;
  END IF;
  RETURN QUERY
  SELECT p.id,p.usuario,p.nombre,p.apellido,p.estado
    FROM public.perfiles p
   WHERE p.estado='activo' AND p.es_admin=false AND p.es_dependiente=true
     AND (lower(trim(p.usuario))=v_lc OR lower(trim(p.correo))=v_lc OR lower(trim(p.nombre))=v_lc)
   ORDER BY CASE WHEN lower(trim(p.usuario))=v_lc THEN 0 WHEN lower(trim(p.correo))=v_lc THEN 1 WHEN lower(trim(p.nombre))=v_lc THEN 2 ELSE 3 END,p.id
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe ninguna cuenta dependiente con ese usuario, nombre o correo electrónico'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.transferir_saldo_atomica(
  p_destinatario_id uuid,
  p_cantidad numeric,
  p_motivo text DEFAULT 'Transferencia',
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_emisor public.perfiles%ROWTYPE;
  v_dest public.perfiles%ROWTYPE;
  v_prev public.transferencias_idempotencia%ROWTYPE;
  v_nuevo_emisor numeric;
  v_motivo text := COALESCE(NULLIF(trim(p_motivo), ''), 'Transferencia');
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_transferencia_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 OR p_cantidad <> trunc(p_cantidad) THEN
    RAISE EXCEPTION 'La cantidad debe ser un entero mayor que 0';
  END IF;
  IF p_destinatario_id IS NULL OR p_destinatario_id = auth.uid() THEN
    RAISE EXCEPTION 'Destinatario inválido';
  END IF;
  IF v_key IS NULL THEN RAISE EXCEPTION 'Idempotency key requerida'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

  IF auth.uid() < p_destinatario_id THEN
    SELECT * INTO v_emisor FROM public.perfiles WHERE id=auth.uid() FOR UPDATE;
    SELECT * INTO v_dest FROM public.perfiles WHERE id=p_destinatario_id FOR UPDATE;
  ELSE
    SELECT * INTO v_dest FROM public.perfiles WHERE id=p_destinatario_id FOR UPDATE;
    SELECT * INTO v_emisor FROM public.perfiles WHERE id=auth.uid() FOR UPDATE;
  END IF;
  IF v_emisor.id IS NULL THEN RAISE EXCEPTION 'No se pudo verificar tu cuenta'; END IF;
  IF v_dest.id IS NULL THEN RAISE EXCEPTION 'No existe el destinatario'; END IF;
  IF v_emisor.es_admin THEN RAISE EXCEPTION 'Un admin no realiza transferencias como trabajador'; END IF;
  IF v_emisor.estado <> 'activo' THEN RAISE EXCEPTION 'Tu cuenta no está activa'; END IF;
  IF v_dest.estado <> 'activo' THEN RAISE EXCEPTION 'El destinatario no está activo'; END IF;
  IF v_emisor.es_dependiente IS DISTINCT FROM true THEN RAISE EXCEPTION 'cuenta_solo_fortuna'; END IF;
  IF v_dest.es_dependiente IS DISTINCT FROM true THEN RAISE EXCEPTION 'destinatario_solo_fortuna'; END IF;

  SELECT * INTO v_prev FROM public.transferencias_idempotencia
   WHERE idempotency_key=v_key FOR UPDATE;
  IF FOUND THEN
    IF v_prev.emisor_id<>auth.uid() OR v_prev.destinatario_id<>p_destinatario_id
       OR v_prev.cantidad<>p_cantidad OR v_prev.motivo<>v_motivo THEN
      RAISE EXCEPTION 'idempotency_key_conflict';
    END IF;
    RETURN jsonb_build_object('success',true,'nuevoSaldo',v_prev.nuevo_saldo_emisor,
      'transferenciaId',v_prev.transferencia_id,'idempotent',true);
  END IF;
  IF v_emisor.saldo < p_cantidad THEN RAISE EXCEPTION 'Saldo insuficiente'; END IF;
  v_nuevo_emisor := v_emisor.saldo-p_cantidad;
  v_transferencia_id := gen_random_uuid();
  PERFORM set_config('cuevacoin.trusted_balance_write','1',true);
  UPDATE public.perfiles SET saldo=v_nuevo_emisor WHERE id=v_emisor.id;
  UPDATE public.perfiles SET saldo=saldo+p_cantidad WHERE id=v_dest.id;
  INSERT INTO public.transferencias_idempotencia(
    idempotency_key,transferencia_id,emisor_id,destinatario_id,cantidad,motivo,nuevo_saldo_emisor
  ) VALUES(v_key,v_transferencia_id,v_emisor.id,v_dest.id,p_cantidad,v_motivo,v_nuevo_emisor);
  INSERT INTO public.transacciones(
    usuario_id,contraparte_id,tipo,cantidad,saldo_antes,saldo_despues,motivo,transferencia_id
  ) VALUES
    (v_emisor.id,v_dest.id,'transferencia',-p_cantidad,v_emisor.saldo,v_nuevo_emisor,
     'Transferencia a '||COALESCE(v_dest.nombre,v_dest.usuario)||': '||v_motivo,v_transferencia_id),
    (v_dest.id,v_emisor.id,'transferencia',p_cantidad,v_dest.saldo,v_dest.saldo+p_cantidad,
     'Transferencia recibida de '||COALESCE(v_emisor.nombre,v_emisor.usuario)||': '||v_motivo,v_transferencia_id);
  INSERT INTO public.auditoria(usuario_id,usuario_nombre,accion)
  VALUES(v_emisor.id,COALESCE(v_emisor.nombre,v_emisor.usuario),
    'Transferencia de $'||trim(to_char(p_cantidad,'FM999999990.00'))||' a '||COALESCE(v_dest.nombre,v_dest.usuario));
  RETURN jsonb_build_object('success',true,'nuevoSaldo',v_nuevo_emisor,
    'transferenciaId',v_transferencia_id,'idempotent',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolver_destinatario_transferencia(p_identificador text)
RETURNS TABLE(id uuid, usuario text, nombre text, correo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v text := NULLIF(trim(p_identificador), '');
  v_lc text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF v IS NULL THEN RAISE EXCEPTION 'Identificador requerido'; END IF;
  v_lc := lower(v);
  RETURN QUERY
  SELECT p.id,p.usuario,p.nombre,p.correo
    FROM public.perfiles p
   WHERE p.estado='activo' AND p.es_admin=false AND p.es_dependiente=true
     AND (lower(trim(p.usuario))=v_lc OR lower(trim(p.correo))=v_lc OR lower(trim(p.nombre))=v_lc)
   ORDER BY CASE WHEN lower(trim(p.usuario))=v_lc THEN 0 WHEN lower(trim(p.correo))=v_lc THEN 1 WHEN lower(trim(p.nombre))=v_lc THEN 2 ELSE 3 END,p.id
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe ninguna cuenta dependiente con ese usuario, nombre o correo electrónico'; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION fortuna_private.fortuna_preview_profile_history_migration(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_preview_profile_history_migration(uuid) TO authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_migrate_profile_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_migrate_profile_history(uuid) TO authenticated;
REVOKE ALL ON FUNCTION api.preview_fortuna_profile_history_migration(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.preview_fortuna_profile_history_migration(uuid) TO authenticated;
REVOKE ALL ON FUNCTION api.migrate_fortuna_profile_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.migrate_fortuna_profile_history(uuid) TO authenticated;


-- Defense in depth: no CuevaCoin financial RPC may mutate the balance of a
-- profile classified as FORTUNA-only, even if a future RPC forgets its own guard.
CREATE OR REPLACE FUNCTION public.proteger_saldo_solo_dependientes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.saldo IS DISTINCT FROM OLD.saldo
     AND OLD.es_admin IS DISTINCT FROM true
     AND OLD.es_dependiente IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'cuenta_solo_fortuna';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS proteger_saldo_solo_dependientes ON public.perfiles;
CREATE TRIGGER proteger_saldo_solo_dependientes
BEFORE UPDATE OF saldo ON public.perfiles
FOR EACH ROW EXECUTE FUNCTION public.proteger_saldo_solo_dependientes();

REVOKE ALL ON FUNCTION public.proteger_saldo_solo_dependientes() FROM PUBLIC, anon, authenticated;

COMMIT;
