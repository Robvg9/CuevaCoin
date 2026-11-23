-- CuevaCoin — salary batch verification. All writes are rolled back.
BEGIN;
DO $test$
DECLARE v_admin uuid;v_worker uuid;v_second uuid;v_key uuid:=gen_random_uuid();v_payload jsonb;v_first record;v_replay record;v_before numeric;v_after numeric;v_tx_before bigint;v_tx_after bigint;v_error text;v_is_dependent boolean;
BEGIN
 SELECT id INTO v_admin FROM public.perfiles WHERE es_admin=true AND estado='activo' ORDER BY id LIMIT 1;
 SELECT id INTO v_worker FROM public.perfiles WHERE es_admin=false AND estado='activo' AND es_dependiente IS TRUE ORDER BY id LIMIT 1;
 IF v_admin IS NULL OR v_worker IS NULL THEN RAISE EXCEPTION 'TEST SETUP: active admin and worker required';END IF;
 PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
 -- An ordinary profile owner cannot promote themselves into the payroll roster.
 UPDATE public.perfiles SET es_dependiente=false WHERE id=v_worker;
 PERFORM set_config('request.jwt.claim.sub',v_worker::text,true);
 UPDATE public.perfiles SET es_dependiente=true WHERE id=v_worker;
 SELECT es_dependiente INTO v_is_dependent FROM public.perfiles WHERE id=v_worker;
 IF v_is_dependent IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL: profile owner self-promoted into dependent payroll role'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
 UPDATE public.perfiles SET es_dependiente=true WHERE id=v_worker;
 SELECT saldo INTO v_before FROM public.perfiles WHERE id=v_worker;SELECT count(*) INTO v_tx_before FROM public.transacciones WHERE usuario_id=v_worker;
 v_payload:=jsonb_build_array(jsonb_build_object('usuario_id',v_worker,'monto',1.25,'dias',jsonb_build_array(current_date::text,(current_date-1)::text)));
 SELECT * INTO v_first FROM public.admin_pagar_salarios_individuales(v_payload,v_key);
 IF v_first.exitoso IS DISTINCT FROM true OR v_first.replayed IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL: first batch not confirmed';END IF;
 SELECT * INTO v_replay FROM public.admin_pagar_salarios_individuales(v_payload,v_key);
 IF v_replay.exitoso IS DISTINCT FROM true OR v_replay.replayed IS DISTINCT FROM true OR v_replay.transaccion_id IS DISTINCT FROM v_first.transaccion_id THEN RAISE EXCEPTION 'FAIL: replay did not return original transaction';END IF;
 SELECT saldo INTO v_after FROM public.perfiles WHERE id=v_worker;SELECT count(*) INTO v_tx_after FROM public.transacciones WHERE usuario_id=v_worker;
 IF v_after IS DISTINCT FROM v_before+1.25 OR v_tx_after IS DISTINCT FROM v_tx_before+1 THEN RAISE EXCEPTION 'FAIL: retry duplicated the balance or ledger';END IF;
 BEGIN
  PERFORM * FROM public.admin_pagar_salarios_individuales(jsonb_build_array(jsonb_build_object('usuario_id',v_worker,'monto',2.50,'dias',jsonb_build_array(current_date::text,(current_date-1)::text))),v_key);
  RAISE EXCEPTION 'FAIL: idempotency key accepted a different payload';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;IF v_error NOT LIKE '%idempotency_key_payload_mismatch%' THEN RAISE;END IF;END;
 SELECT id INTO v_second FROM public.perfiles WHERE es_admin=false AND estado='activo' AND es_dependiente IS TRUE AND id>v_worker ORDER BY id LIMIT 1;
 IF v_second IS NOT NULL THEN
  UPDATE public.perfiles SET estado='inactivo' WHERE id=v_second;
  SELECT saldo INTO v_before FROM public.perfiles WHERE id=v_worker;SELECT count(*) INTO v_tx_before FROM public.transacciones WHERE usuario_id=v_worker;
  BEGIN
   PERFORM * FROM public.admin_pagar_salarios_individuales(jsonb_build_array(jsonb_build_object('usuario_id',v_second,'monto',1,'dias',jsonb_build_array(current_date::text)),jsonb_build_object('usuario_id',v_worker,'monto',1,'dias',jsonb_build_array(current_date::text))),gen_random_uuid());
   RAISE EXCEPTION 'FAIL: inactive recipient accepted';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;IF v_error NOT LIKE '%No se puede pagar a una cuenta no activa%' THEN RAISE;END IF;END;
  SELECT saldo INTO v_after FROM public.perfiles WHERE id=v_worker;SELECT count(*) INTO v_tx_after FROM public.transacciones WHERE usuario_id=v_worker;
  IF v_after IS DISTINCT FROM v_before OR v_tx_after IS DISTINCT FROM v_tx_before THEN RAISE EXCEPTION 'FAIL: earlier recipient was credited despite rejected batch';END IF;
  UPDATE public.perfiles SET estado='activo' WHERE id=v_second;
 END IF;
 -- A profile removed from the dependent roster must be rejected by both salary and bonus RPCs.
 UPDATE public.perfiles SET es_dependiente=false WHERE id=v_worker;
 SELECT saldo INTO v_before FROM public.perfiles WHERE id=v_worker;
 SELECT count(*) INTO v_tx_before FROM public.transacciones WHERE usuario_id=v_worker;
 BEGIN
  PERFORM * FROM public.admin_pagar_salarios_individuales(
   jsonb_build_array(jsonb_build_object('usuario_id',v_worker,'monto',1,'dias',jsonb_build_array(current_date::text))),
   gen_random_uuid()
  );
  RAISE EXCEPTION 'FAIL: non-dependent recipient accepted by salary batch';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
  IF v_error NOT LIKE '%no está clasificada como dependiente%' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM * FROM public.admin_pagar_saldo(ARRAY[v_worker],1,'Local role guard test','bono');
  RAISE EXCEPTION 'FAIL: non-dependent recipient accepted by bonus RPC';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
  IF v_error NOT LIKE '%no está clasificada como dependiente%' THEN RAISE; END IF;
 END;
 SELECT saldo INTO v_after FROM public.perfiles WHERE id=v_worker;
 SELECT count(*) INTO v_tx_after FROM public.transacciones WHERE usuario_id=v_worker;
 IF v_after IS DISTINCT FROM v_before OR v_tx_after IS DISTINCT FROM v_tx_before THEN
  RAISE EXCEPTION 'FAIL: non-dependent rejection changed balance or transaction ledger';
 END IF;
 UPDATE public.perfiles SET es_dependiente=true WHERE id=v_worker;
 RAISE NOTICE 'PASS: salary batch, idempotent replay, mismatch rejection, inactive worker, self-promotion rejection, non-dependent salary/bonus rejection and batch rollback';
END;
$test$;
ROLLBACK;
