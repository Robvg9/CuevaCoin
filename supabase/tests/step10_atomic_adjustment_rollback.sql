-- Step 10 transactional functional test for the actual CuevaCoin database.
-- IMPORTANT: the entire script is rolled back. It moves no funds permanently.
-- Run ONLY after the Step 10 migration has been applied to project zqgmjwfvluboiporytcq.
BEGIN;

CREATE OR REPLACE FUNCTION public.step10_test_reject_audit_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $test$
BEGIN
    IF NEW.accion LIKE '%STEP10_FORCE_ATOMIC_ROLLBACK_TEST%' THEN
        RAISE EXCEPTION 'STEP10_FORCE_ATOMIC_ROLLBACK_TEST';
    END IF;
    RETURN NEW;
END;
$test$;

CREATE TRIGGER step10_test_reject_audit_marker
BEFORE INSERT ON public.auditoria
FOR EACH ROW EXECUTE FUNCTION public.step10_test_reject_audit_marker();

DO $test$
DECLARE
    v_admin uuid;
    v_worker uuid;
    v_balance_before numeric;
    v_balance_after numeric;
    v_key uuid := gen_random_uuid();
    v_fail_key uuid := gen_random_uuid();
    v_mismatch_message text;
    v_first record;
    v_replay record;
    v_tx_before bigint;
    v_tx_after bigint;
    v_notif_before bigint;
    v_notif_after bigint;
    v_audit_before bigint;
    v_audit_after bigint;
    v_admin_id uuid;
    v_worker_id uuid;
    v_force_balance numeric;
BEGIN
    SELECT id INTO v_admin FROM public.perfiles WHERE es_admin IS TRUE ORDER BY id LIMIT 1;
    SELECT id, saldo INTO v_worker, v_balance_before
      FROM public.perfiles
     WHERE es_admin IS FALSE AND estado = 'activo'
     ORDER BY id
     LIMIT 1
     FOR UPDATE;
    IF v_admin IS NULL OR v_worker IS NULL THEN
        RAISE EXCEPTION 'TEST BLOCKED: needs an admin and an active worker profile';
    END IF;

    -- Use a real admin JWT subject for auth.uid() but keep all changes in this transaction.
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    -- Direct client-style balance writes must fail even for a real admin subject.
    BEGIN
        UPDATE public.perfiles SET saldo = saldo + 1 WHERE id = v_worker;
        RAISE EXCEPTION 'FAIL: direct profile balance update was accepted';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_mismatch_message = MESSAGE_TEXT;
        IF v_mismatch_message NOT LIKE '%saldo_update_requires_atomic_rpc%' THEN
            RAISE;
        END IF;
    END;

    SELECT * INTO v_first
      FROM public.admin_ajustar_saldo_atomico(
        v_worker, 'deposito', 1, 'STEP10_SUCCESS_REPLAY_TEST', v_key
      );
    IF v_first.transaccion_id IS NULL OR v_first.replayed IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FAIL: first adjustment did not return new transaction evidence';
    END IF;

    SELECT * INTO v_replay
      FROM public.admin_ajustar_saldo_atomico(
        v_worker, 'deposito', 1, 'STEP10_SUCCESS_REPLAY_TEST', v_key
      );
    IF v_replay.transaccion_id IS DISTINCT FROM v_first.transaccion_id
       OR v_replay.replayed IS DISTINCT FROM true
       OR v_replay.saldo_despues IS DISTINCT FROM v_first.saldo_despues THEN
        RAISE EXCEPTION 'FAIL: idempotent replay changed transaction/saldo evidence';
    END IF;

    SELECT saldo INTO v_balance_after FROM public.perfiles WHERE id = v_worker;
    IF v_balance_after IS DISTINCT FROM (v_balance_before + 1) THEN
        RAISE EXCEPTION 'FAIL: balance not incremented exactly once (before %, after %)', v_balance_before, v_balance_after;
    END IF;
    IF (SELECT count(*) FROM public.transacciones WHERE id = v_first.transaccion_id) <> 1 THEN
        RAISE EXCEPTION 'FAIL: replay duplicated the ledger row';
    END IF;
    IF (SELECT count(*) FROM public.admin_ajustes_saldo_idempotencia WHERE idempotency_key = v_key AND completada) <> 1 THEN
        RAISE EXCEPTION 'FAIL: idempotency evidence not persisted inside transaction';
    END IF;

    -- Reusing the key with a different payload must be rejected.
    BEGIN
        PERFORM * FROM public.admin_ajustar_saldo_atomico(
            v_worker, 'deposito', 2, 'STEP10_SUCCESS_REPLAY_TEST', v_key
        );
        RAISE EXCEPTION 'FAIL: conflicting idempotency payload was accepted';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_mismatch_message = MESSAGE_TEXT;
        IF v_mismatch_message NOT LIKE '%idempotency_key_payload_mismatch%' THEN
            RAISE;
        END IF;
    END;

    -- A non-admin authenticated subject must not make a balance change.
    PERFORM set_config('request.jwt.claim.sub', v_worker::text, true);
    BEGIN
        PERFORM * FROM public.admin_ajustar_saldo_atomico(
            v_worker, 'deposito', 1, 'STEP10_NONADMIN_TEST', gen_random_uuid()
        );
        RAISE EXCEPTION 'FAIL: non-admin was allowed to adjust a balance';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_mismatch_message = MESSAGE_TEXT;
        IF v_mismatch_message NOT LIKE '%No autorizado: se requiere administrador%' THEN
            RAISE;
        END IF;
    END;
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    -- An oversized withdrawal must be rejected without changing balance.
    BEGIN
        PERFORM * FROM public.admin_ajustar_saldo_atomico(
            v_worker, 'retiro', 999999999999, 'STEP10_INSUFFICIENT_FUNDS_TEST', gen_random_uuid()
        );
        RAISE EXCEPTION 'FAIL: negative-balance adjustment was accepted';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_mismatch_message = MESSAGE_TEXT;
        IF v_mismatch_message NOT LIKE '%Saldo insuficiente%' THEN
            RAISE;
        END IF;
    END;

    -- Failure at the final audit write must roll back every earlier write in the RPC.
    SELECT saldo INTO v_force_balance FROM public.perfiles WHERE id = v_worker;
    SELECT count(*) INTO v_tx_before FROM public.transacciones WHERE usuario_id = v_worker;
    SELECT count(*) INTO v_notif_before FROM public.notificaciones WHERE usuario_id = v_worker;
    SELECT count(*) INTO v_audit_before FROM public.auditoria WHERE usuario_id = v_admin;

    BEGIN
        PERFORM * FROM public.admin_ajustar_saldo_atomico(
            v_worker, 'deposito', 1, 'STEP10_FORCE_ATOMIC_ROLLBACK_TEST', v_fail_key
        );
        RAISE EXCEPTION 'FAIL: forced audit failure did not fire';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_mismatch_message = MESSAGE_TEXT;
        IF v_mismatch_message NOT LIKE '%STEP10_FORCE_ATOMIC_ROLLBACK_TEST%' THEN
            RAISE;
        END IF;
    END;

    SELECT saldo INTO v_balance_after FROM public.perfiles WHERE id = v_worker;
    SELECT count(*) INTO v_tx_after FROM public.transacciones WHERE usuario_id = v_worker;
    SELECT count(*) INTO v_notif_after FROM public.notificaciones WHERE usuario_id = v_worker;
    SELECT count(*) INTO v_audit_after FROM public.auditoria WHERE usuario_id = v_admin;

    IF v_balance_after IS DISTINCT FROM v_force_balance
       OR v_tx_after IS DISTINCT FROM v_tx_before
       OR v_notif_after IS DISTINCT FROM v_notif_before
       OR v_audit_after IS DISTINCT FROM v_audit_before
       OR EXISTS (SELECT 1 FROM public.admin_ajustes_saldo_idempotencia WHERE idempotency_key = v_fail_key) THEN
        RAISE EXCEPTION 'FAIL: forced error left a partial financial effect';
    END IF;

    RAISE NOTICE 'PASS: deposit, idempotent replay, mismatched payload rejection, non-admin denial, insufficient funds and atomic rollback';
END;
$test$;

ROLLBACK;
