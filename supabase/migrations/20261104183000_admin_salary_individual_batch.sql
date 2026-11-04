-- CuevaCoin — individual salary batches with per-worker idempotency.
-- Target: zqgmjwfvluboiporytcq. This migration defines the path; it does not move balances.
BEGIN;
CREATE TABLE public.admin_pagos_salario_idempotencia(
 idempotency_key uuid PRIMARY KEY,
 admin_id uuid NOT NULL REFERENCES public.perfiles(id),
 payload jsonb NOT NULL,
 resultado jsonb,
 completada boolean NOT NULL DEFAULT false,
 creado_en timestamptz NOT NULL DEFAULT now(),
 completado_en timestamptz
);
ALTER TABLE public.admin_pagos_salario_idempotencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_pagos_salario_idempotencia FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_pagar_salarios_individuales(p_pagos jsonb,p_idempotency_key uuid)
RETURNS TABLE(usuario_id uuid,nombre text,monto numeric,nuevo_saldo numeric,transaccion_id uuid,exitoso boolean,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
DECLARE
 v_admin_id uuid:=auth.uid();v_admin public.perfiles%ROWTYPE;v_target public.perfiles%ROWTYPE;v_batch public.admin_pagos_salario_idempotencia%ROWTYPE;
 v_item jsonb;v_user_id uuid;v_monto numeric;v_days_json jsonb;v_days date[];v_days_count integer;v_unique_days integer;
 v_ids uuid[]:=ARRAY[]::uuid[];v_payload jsonb:='[]'::jsonb;v_result jsonb:='[]'::jsonb;v_reason text;v_days_text text;v_message text;
 v_before numeric;v_after numeric;v_tx uuid;v_name text;
BEGIN
 IF v_admin_id IS NULL THEN RAISE EXCEPTION 'No autenticado';END IF;
 SELECT p.* INTO v_admin FROM public.perfiles p WHERE p.id=v_admin_id;
 IF NOT FOUND OR v_admin.es_admin IS DISTINCT FROM true OR v_admin.estado IS DISTINCT FROM 'activo' THEN RAISE EXCEPTION 'No autorizado: se requiere un administrador activo';END IF;
 IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Se requiere una clave de idempotencia para el lote';END IF;
 IF jsonb_typeof(p_pagos) IS DISTINCT FROM 'array' OR jsonb_array_length(p_pagos)<1 OR jsonb_array_length(p_pagos)>100 THEN RAISE EXCEPTION 'El lote debe incluir entre 1 y 100 trabajadoras';END IF;

 FOR v_item IN SELECT value FROM jsonb_array_elements(p_pagos) ORDER BY value->>'usuario_id' LOOP
  v_user_id:=NULLIF(pg_catalog.btrim(v_item->>'usuario_id'),'')::uuid;
  v_monto:=NULLIF(pg_catalog.btrim(v_item->>'monto'),'')::numeric;
  v_days_json:=v_item->'dias';
  IF v_user_id IS NULL OR v_user_id=ANY(v_ids) THEN RAISE EXCEPTION 'Destinataria inválida o repetida en el lote';END IF;
  IF v_monto IS NULL OR v_monto<=0 OR v_monto<>round(v_monto,2) THEN RAISE EXCEPTION 'Cada salario debe tener un monto positivo con máximo dos decimales';END IF;
  IF jsonb_typeof(v_days_json) IS DISTINCT FROM 'array' OR jsonb_array_length(v_days_json)<1 OR jsonb_array_length(v_days_json)>31 THEN RAISE EXCEPTION 'Selecciona entre 1 y 31 días trabajados para cada salario';END IF;
  SELECT array_agg(day_value ORDER BY day_value),count(*),count(DISTINCT day_value) INTO v_days,v_days_count,v_unique_days
   FROM(SELECT(value #>> '{}')::date AS day_value FROM jsonb_array_elements(v_days_json)) parsed;
  IF v_days_count IS DISTINCT FROM jsonb_array_length(v_days_json) OR v_days_count IS DISTINCT FROM v_unique_days OR v_days IS NULL THEN RAISE EXCEPTION 'Los días trabajados deben ser fechas válidas y no repetidas';END IF;
  v_ids:=array_append(v_ids,v_user_id);
  v_payload:=v_payload||jsonb_build_array(jsonb_build_object('usuario_id',v_user_id,'monto',v_monto,'dias',to_jsonb(v_days)));
 END LOOP;

 INSERT INTO public.admin_pagos_salario_idempotencia(idempotency_key,admin_id,payload)
 VALUES(p_idempotency_key,v_admin_id,v_payload) ON CONFLICT(idempotency_key) DO NOTHING RETURNING * INTO v_batch;
 IF NOT FOUND THEN
  SELECT b.* INTO v_batch FROM public.admin_pagos_salario_idempotencia b WHERE b.idempotency_key=p_idempotency_key FOR UPDATE;
  IF NOT FOUND OR v_batch.admin_id IS DISTINCT FROM v_admin_id THEN RAISE EXCEPTION 'idempotency_key_conflict';END IF;
  IF v_batch.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'idempotency_key_payload_mismatch';END IF;
  IF v_batch.completada IS DISTINCT FROM true OR v_batch.resultado IS NULL THEN RAISE EXCEPTION 'El lote previo no tiene un resultado completo; requiere revisión';END IF;
  RETURN QUERY SELECT r.usuario_id,r.nombre,r.monto,r.nuevo_saldo,r.transaccion_id,r.exitoso,true
   FROM jsonb_to_recordset(v_batch.resultado) AS r(usuario_id uuid,nombre text,monto numeric,nuevo_saldo numeric,transaccion_id uuid,exitoso boolean);
  RETURN;
 END IF;

 -- A failure on any later recipient aborts the whole RPC transaction, including earlier credits.
 FOR v_item IN SELECT value FROM jsonb_array_elements(v_payload) LOOP
  v_user_id:=(v_item->>'usuario_id')::uuid;v_monto:=(v_item->>'monto')::numeric;
  SELECT array_agg((value #>> '{}')::date ORDER BY(value #>> '{}')::date) INTO v_days FROM jsonb_array_elements(v_item->'dias');
  SELECT string_agg(pg_catalog.to_char(d,'DD/MM/YYYY'),', ' ORDER BY d) INTO v_days_text FROM unnest(v_days) d;
  v_reason:='Salario de los días '||v_days_text;
  SELECT p.* INTO v_target FROM public.perfiles p WHERE p.id=v_user_id AND p.es_admin=false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró una trabajadora válida para el salario';END IF;
  IF v_target.estado IS DISTINCT FROM 'activo' THEN RAISE EXCEPTION 'No se puede pagar a una cuenta no activa: %',v_user_id;END IF;
  v_before:=v_target.saldo;PERFORM set_config('cuevacoin.trusted_balance_write','1',true);
  UPDATE public.perfiles p SET saldo=p.saldo+v_monto WHERE p.id=v_user_id RETURNING p.saldo INTO v_after;
  v_name:=COALESCE(NULLIF(pg_catalog.btrim(v_target.nombre),''),v_target.usuario);
  INSERT INTO public.transacciones(usuario_id,admin_id,tipo,cantidad,saldo_antes,saldo_despues,motivo)
  VALUES(v_user_id,v_admin_id,'deposito_admin',v_monto,v_before,v_after,v_reason) RETURNING id INTO v_tx;
  v_message:='Has recibido un salario de $'||pg_catalog.to_char(v_monto,'FM999999990.00')||'. '||v_reason||'.';
  INSERT INTO public.notificaciones(usuario_id,mensaje,leida,tipo_evento) VALUES(v_user_id,v_message,false,'pago_admin');
  INSERT INTO public.auditoria(usuario_id,usuario_nombre,accion)
  VALUES(v_admin_id,COALESCE(NULLIF(pg_catalog.btrim(v_admin.nombre),''),v_admin.usuario),
   'Pagó salario a '||v_name||': $'||pg_catalog.to_char(v_monto,'FM999999990.00')||' ('||v_reason||')');
  v_result:=v_result||jsonb_build_array(jsonb_build_object('usuario_id',v_user_id,'nombre',v_name,'monto',v_monto,'nuevo_saldo',v_after,'transaccion_id',v_tx,'exitoso',true));
 END LOOP;
 UPDATE public.admin_pagos_salario_idempotencia b SET resultado=v_result,completada=true,completado_en=now() WHERE b.idempotency_key=p_idempotency_key;
 RETURN QUERY SELECT r.usuario_id,r.nombre,r.monto,r.nuevo_saldo,r.transaccion_id,r.exitoso,false
  FROM jsonb_to_recordset(v_result) AS r(usuario_id uuid,nombre text,monto numeric,nuevo_saldo numeric,transaccion_id uuid,exitoso boolean);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_pagar_salarios_individuales(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_pagar_salarios_individuales(jsonb,uuid) TO authenticated,service_role;
COMMENT ON FUNCTION public.admin_pagar_salarios_individuales(jsonb,uuid)
 IS 'Admin-only atomic per-worker salary batch. Exact-payload idempotent replay; selected work dates are recorded in ledger, notification and audit.';
COMMIT;
