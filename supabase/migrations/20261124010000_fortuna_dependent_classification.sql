-- FORTUNA V169: separate private-ledger contacts from business dependents.
-- Existing active profiles already linked into FORTUNA become private-only by default.
-- Other existing active non-admin profiles remain dependents to preserve current payroll.
-- New profiles default to private-only until explicitly classified as dependents.
BEGIN;

ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS es_dependiente boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.perfiles.es_dependiente IS
  'Business employment classification. Only true profiles belong to the CuevaCoin/BattleCruiser dependent roster and may receive payroll. Independent of FORTUNA contact linkage.';

UPDATE public.perfiles AS p
   SET es_dependiente = NOT EXISTS (
     SELECT 1
       FROM fortuna_private.financial_contacts AS c
      WHERE c.linked_profile_id = p.id
   )
 WHERE p.es_admin IS FALSE
   AND p.estado = 'activo';

-- Prevent ordinary authenticated users from self-promoting into the payroll roster.
-- Preserve the existing protected-column behavior and add es_dependiente.
CREATE OR REPLACE FUNCTION public.proteger_columnas_sensibles_perfil()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('cuevacoin.trusted_balance_write', true) IS DISTINCT FROM '1'
       AND NEW.saldo IS DISTINCT FROM OLD.saldo THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'saldo_update_requires_atomic_rpc';
    END IF;

    IF NOT (
        public.es_admin()
        OR auth.role() = 'service_role'
        OR current_setting('cuevacoin.trusted_balance_write', true) = '1'
    ) THEN
        NEW.es_admin := OLD.es_admin;
        NEW.estado := OLD.estado;
        NEW.numero_cuenta := OLD.numero_cuenta;
        NEW.usuario := OLD.usuario;
        NEW.correo_verificado := OLD.correo_verificado;
        NEW.fecha_limite_verificacion := OLD.fecha_limite_verificacion;
        NEW.es_dependiente := OLD.es_dependiente;
    END IF;
    RETURN NEW;
END;
$function$;

-- Search only active non-admin accounts, and disclose their current business role
-- to the authenticated active owner so the role choice is never made blindly.
CREATE OR REPLACE FUNCTION fortuna_private.fortuna_search_profiles(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_search_profiles$
DECLARE
  v_actor uuid := auth.uid();
  v_query text := pg_catalog.btrim(COALESCE(p_query, ''));
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.perfiles AS owner_profile
     WHERE owner_profile.id = v_actor
       AND owner_profile.es_admin IS TRUE
       AND owner_profile.estado = 'activo'
  ) THEN
    RAISE EXCEPTION 'fortuna_owner_required' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.length(v_query) < 2 OR pg_catalog.length(v_query) > 80 THEN
    RAISE EXCEPTION 'fortuna_profile_query_invalid';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'profile_id', p.id,
      'username', p.usuario,
      'display_name', COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', p.nombre, p.apellido)), ''), p.usuario),
      'is_dependent', p.es_dependiente
    )
    ORDER BY pg_catalog.lower(p.usuario), p.id
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT id, usuario, nombre, apellido, es_dependiente
      FROM public.perfiles
     WHERE estado = 'activo'
       AND es_admin IS FALSE
       AND id <> v_actor
       AND (
         pg_catalog.strpos(pg_catalog.lower(COALESCE(usuario, '')), pg_catalog.lower(v_query)) > 0
         OR pg_catalog.strpos(pg_catalog.lower(pg_catalog.concat_ws(' ', nombre, apellido)), pg_catalog.lower(v_query)) > 0
       )
     ORDER BY pg_catalog.lower(usuario), id
     LIMIT 20
  ) AS p;

  RETURN v_result;
END;
$fortuna_search_profiles$;

CREATE OR REPLACE FUNCTION api.search_fortuna_profiles(p_query text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_search_profiles$
  SELECT fortuna_private.fortuna_search_profiles($1);
$fortuna_api_search_profiles$;

REVOKE ALL ON FUNCTION fortuna_private.fortuna_search_profiles(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_search_profiles(text) TO authenticated;
REVOKE ALL ON FUNCTION api.search_fortuna_profiles(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.search_fortuna_profiles(text) TO authenticated;

-- Replace the link operation with an explicit, owner-authorized role choice.
DROP FUNCTION IF EXISTS api.link_fortuna_profile_contact(uuid);
DROP FUNCTION IF EXISTS fortuna_private.fortuna_link_profile_contact(uuid);

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_link_profile_contact(
  p_profile_id uuid,
  p_is_dependent boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_link_profile_contact$
DECLARE
  v_actor uuid := auth.uid();
  v_book_id uuid;
  v_name text;
  v_username text;
  v_contact_id uuid;
  v_balance numeric;
  v_is_new_contact boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.perfiles AS owner_profile
     WHERE owner_profile.id = v_actor
       AND owner_profile.es_admin IS TRUE
       AND owner_profile.estado = 'activo'
  ) THEN
    RAISE EXCEPTION 'fortuna_owner_required' USING ERRCODE = '42501';
  END IF;
  IF p_profile_id IS NULL OR p_profile_id = v_actor OR p_is_dependent IS NULL THEN
    RAISE EXCEPTION 'fortuna_profile_invalid';
  END IF;

  SELECT
    COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', p.nombre, p.apellido)), ''), p.usuario),
    p.usuario,
    COALESCE(p.saldo, 0)
  INTO v_name, v_username, v_balance
  FROM public.perfiles AS p
  WHERE p.id = p_profile_id
    AND p.es_admin IS FALSE
    AND p.estado = 'activo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fortuna_profile_not_found';
  END IF;

  v_book_id := fortuna_private.fortuna_ensure_current_book_id();

  SELECT c.id INTO v_contact_id
    FROM fortuna_private.financial_contacts AS c
   WHERE c.book_id = v_book_id
     AND c.linked_profile_id = p_profile_id
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO fortuna_private.financial_contacts(book_id, display_name, linked_profile_id)
    VALUES (v_book_id, v_name, p_profile_id)
    ON CONFLICT (book_id, linked_profile_id) WHERE linked_profile_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_contact_id;
    IF FOUND THEN
      v_is_new_contact := true;
    ELSE
      SELECT c.id INTO v_contact_id
        FROM fortuna_private.financial_contacts AS c
       WHERE c.book_id = v_book_id
         AND c.linked_profile_id = p_profile_id
       FOR UPDATE;
    END IF;
  END IF;

  UPDATE public.perfiles
     SET es_dependiente = p_is_dependent
   WHERE id = p_profile_id
     AND es_admin IS FALSE;

  RETURN pg_catalog.jsonb_build_object(
    'contact_id', v_contact_id,
    'display_name', v_name,
    'username', v_username,
    'linked_profile_id', p_profile_id,
    'is_dependent', p_is_dependent,
    'is_new_contact', v_is_new_contact,
    'balance_minor', CASE WHEN v_balance > 0 THEN pg_catalog.round(v_balance * 100)::bigint::text ELSE '0' END
  );
END;
$fortuna_link_profile_contact$;

CREATE OR REPLACE FUNCTION api.link_fortuna_profile_contact(
  p_profile_id uuid,
  p_is_dependent boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_link_profile_contact$
  SELECT fortuna_private.fortuna_link_profile_contact($1, $2);
$fortuna_api_link_profile_contact$;

REVOKE ALL ON FUNCTION fortuna_private.fortuna_link_profile_contact(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_link_profile_contact(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION api.link_fortuna_profile_contact(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.link_fortuna_profile_contact(uuid, boolean) TO authenticated;

-- Defense in depth: payroll RPCs must reject accounts outside the dependent roster.
CREATE OR REPLACE FUNCTION public.admin_pagar_salarios_individuales(
  p_pagos jsonb,
  p_idempotency_key uuid
)
RETURNS TABLE(
  usuario_id uuid,
  nombre text,
  monto numeric,
  nuevo_saldo numeric,
  transaccion_id uuid,
  exitoso boolean,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
 v_admin_id uuid := auth.uid();
 v_admin public.perfiles%ROWTYPE;
 v_target public.perfiles%ROWTYPE;
 v_batch public.admin_pagos_salario_idempotencia%ROWTYPE;
 v_item jsonb;
 v_user_id uuid;
 v_monto numeric;
 v_days_json jsonb;
 v_days date[];
 v_days_count integer;
 v_unique_days integer;
 v_ids uuid[] := ARRAY[]::uuid[];
 v_payload jsonb := '[]'::jsonb;
 v_result jsonb := '[]'::jsonb;
 v_reason text;
 v_days_text text;
 v_message text;
 v_before numeric;
 v_after numeric;
 v_tx uuid;
 v_name text;
BEGIN
 IF v_admin_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
 SELECT p.* INTO v_admin FROM public.perfiles p WHERE p.id = v_admin_id;
 IF NOT FOUND OR v_admin.es_admin IS DISTINCT FROM true OR v_admin.estado IS DISTINCT FROM 'activo' THEN
   RAISE EXCEPTION 'No autorizado: se requiere un administrador activo';
 END IF;
 IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Se requiere una clave de idempotencia para el lote'; END IF;
 IF jsonb_typeof(p_pagos) IS DISTINCT FROM 'array' OR jsonb_array_length(p_pagos) < 1 OR jsonb_array_length(p_pagos) > 100 THEN
   RAISE EXCEPTION 'El lote debe incluir entre 1 y 100 dependientes';
 END IF;

 FOR v_item IN SELECT value FROM jsonb_array_elements(p_pagos) ORDER BY value->>'usuario_id' LOOP
  v_user_id := NULLIF(pg_catalog.btrim(v_item->>'usuario_id'), '')::uuid;
  v_monto := NULLIF(pg_catalog.btrim(v_item->>'monto'), '')::numeric;
  v_days_json := v_item->'dias';
  IF v_user_id IS NULL OR v_user_id = ANY(v_ids) THEN RAISE EXCEPTION 'Destinataria inválida o repetida en el lote'; END IF;
  IF v_monto IS NULL OR v_monto <= 0 OR v_monto <> round(v_monto, 2) THEN RAISE EXCEPTION 'Cada salario debe tener un monto positivo con máximo dos decimales'; END IF;
  IF jsonb_typeof(v_days_json) IS DISTINCT FROM 'array' OR jsonb_array_length(v_days_json) < 1 OR jsonb_array_length(v_days_json) > 31 THEN
    RAISE EXCEPTION 'Selecciona entre 1 y 31 días trabajados para cada salario';
  END IF;
  SELECT array_agg(day_value ORDER BY day_value), count(*), count(DISTINCT day_value)
    INTO v_days, v_days_count, v_unique_days
    FROM (SELECT (value #>> '{}')::date AS day_value FROM jsonb_array_elements(v_days_json)) parsed;
  IF v_days_count IS DISTINCT FROM jsonb_array_length(v_days_json)
     OR v_days_count IS DISTINCT FROM v_unique_days OR v_days IS NULL THEN
    RAISE EXCEPTION 'Los días trabajados deben ser fechas válidas y no repetidas';
  END IF;
  v_ids := array_append(v_ids, v_user_id);
  v_payload := v_payload || jsonb_build_array(jsonb_build_object('usuario_id', v_user_id, 'monto', v_monto, 'dias', to_jsonb(v_days)));
 END LOOP;

 INSERT INTO public.admin_pagos_salario_idempotencia(idempotency_key, admin_id, payload)
 VALUES(p_idempotency_key, v_admin_id, v_payload)
 ON CONFLICT(idempotency_key) DO NOTHING
 RETURNING * INTO v_batch;
 IF NOT FOUND THEN
  SELECT b.* INTO v_batch FROM public.admin_pagos_salario_idempotencia b
   WHERE b.idempotency_key = p_idempotency_key FOR UPDATE;
  IF NOT FOUND OR v_batch.admin_id IS DISTINCT FROM v_admin_id THEN RAISE EXCEPTION 'idempotency_key_conflict'; END IF;
  IF v_batch.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'idempotency_key_payload_mismatch'; END IF;
  IF v_batch.completada IS DISTINCT FROM true OR v_batch.resultado IS NULL THEN
    RAISE EXCEPTION 'El lote previo no tiene un resultado completo; requiere revisión';
  END IF;
  RETURN QUERY SELECT r.usuario_id, r.nombre, r.monto, r.nuevo_saldo, r.transaccion_id, r.exitoso, true
   FROM jsonb_to_recordset(v_batch.resultado) AS r(usuario_id uuid, nombre text, monto numeric, nuevo_saldo numeric, transaccion_id uuid, exitoso boolean);
  RETURN;
 END IF;

 -- Lock and validate every recipient before any balance mutation.
 FOR v_item IN SELECT value FROM jsonb_array_elements(v_payload) LOOP
  v_user_id := (v_item->>'usuario_id')::uuid;
  SELECT p.* INTO v_target FROM public.perfiles p
   WHERE p.id = v_user_id AND p.es_admin = false FOR UPDATE;
  IF NOT FOUND OR v_target.es_dependiente IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'La cuenta seleccionada no está clasificada como dependiente: %', v_user_id;
  END IF;
  IF v_target.estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'No se puede pagar a una cuenta no activa: %', v_user_id;
  END IF;
 END LOOP;

 FOR v_item IN SELECT value FROM jsonb_array_elements(v_payload) LOOP
  v_user_id := (v_item->>'usuario_id')::uuid;
  v_monto := (v_item->>'monto')::numeric;
  SELECT array_agg((value #>> '{}')::date ORDER BY (value #>> '{}')::date)
    INTO v_days FROM jsonb_array_elements(v_item->'dias');
  SELECT string_agg(pg_catalog.to_char(d, 'DD/MM/YYYY'), ', ' ORDER BY d)
    INTO v_days_text FROM unnest(v_days) d;
  v_reason := 'Salario de los días ' || v_days_text;
  SELECT p.* INTO v_target FROM public.perfiles p WHERE p.id = v_user_id;
  v_before := v_target.saldo;
  PERFORM set_config('cuevacoin.trusted_balance_write', '1', true);
  UPDATE public.perfiles p SET saldo = p.saldo + v_monto WHERE p.id = v_user_id RETURNING p.saldo INTO v_after;
  v_name := COALESCE(NULLIF(pg_catalog.btrim(v_target.nombre), ''), v_target.usuario);
  INSERT INTO public.transacciones(usuario_id, admin_id, tipo, cantidad, saldo_antes, saldo_despues, motivo)
  VALUES(v_user_id, v_admin_id, 'deposito_admin', v_monto, v_before, v_after, v_reason)
  RETURNING id INTO v_tx;
  v_message := 'Has recibido un salario de $' || pg_catalog.to_char(v_monto, 'FM999999990.00') || '. ' || v_reason || '.';
  INSERT INTO public.notificaciones(usuario_id, mensaje, leida, tipo_evento)
  VALUES(v_user_id, v_message, false, 'pago_admin');
  INSERT INTO public.auditoria(usuario_id, usuario_nombre, accion)
  VALUES(v_admin_id, COALESCE(NULLIF(pg_catalog.btrim(v_admin.nombre), ''), v_admin.usuario),
    'Pagó salario a ' || v_name || ': $' || pg_catalog.to_char(v_monto, 'FM999999990.00') || ' (' || v_reason || ')');
  v_result := v_result || jsonb_build_array(jsonb_build_object('usuario_id', v_user_id, 'nombre', v_name, 'monto', v_monto, 'nuevo_saldo', v_after, 'transaccion_id', v_tx, 'exitoso', true));
 END LOOP;
 UPDATE public.admin_pagos_salario_idempotencia b
  SET resultado = v_result, completada = true, completado_en = now()
  WHERE b.idempotency_key = p_idempotency_key;
 RETURN QUERY SELECT r.usuario_id, r.nombre, r.monto, r.nuevo_saldo, r.transaccion_id, r.exitoso, false
  FROM jsonb_to_recordset(v_result) AS r(usuario_id uuid, nombre text, monto numeric, nuevo_saldo numeric, transaccion_id uuid, exitoso boolean);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_pagar_saldo(
  p_destinatarios uuid[],
  p_monto numeric,
  p_motivo text,
  p_tipo text
)
RETURNS TABLE(usuario_id uuid, nombre text, nuevo_saldo numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
    v_admin public.perfiles%ROWTYPE;
    v_target public.perfiles%ROWTYPE;
    v_id uuid;
    v_motivo_final text;
    v_mensaje_notif text;
    v_before numeric;
BEGIN
    SELECT * INTO v_admin FROM public.perfiles WHERE id = auth.uid();
    IF NOT FOUND OR v_admin.es_admin IS NOT TRUE OR v_admin.estado IS DISTINCT FROM 'activo' THEN
        RAISE EXCEPTION 'Solo un admin activo puede pagar saldo';
    END IF;
    IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;
    IF p_tipo NOT IN ('salario', 'bono') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
    IF p_destinatarios IS NULL OR cardinality(p_destinatarios) = 0 THEN RAISE EXCEPTION 'Selecciona al menos una dependiente'; END IF;
    IF cardinality(p_destinatarios) <> (SELECT count(DISTINCT x) FROM unnest(p_destinatarios) x) THEN
        RAISE EXCEPTION 'Destinatarias repetidas';
    END IF;

    -- Validate and lock the complete recipient set before the first write.
    FOR v_id IN SELECT unnest(p_destinatarios) ORDER BY 1 LOOP
        SELECT * INTO v_target FROM public.perfiles
         WHERE id = v_id AND es_admin = false FOR UPDATE;
        IF NOT FOUND OR v_target.es_dependiente IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'La cuenta seleccionada no está clasificada como dependiente: %', v_id;
        END IF;
        IF v_target.estado IS DISTINCT FROM 'activo' THEN
            RAISE EXCEPTION 'No se puede pagar a una cuenta no activa: %', v_id;
        END IF;
    END LOOP;

    v_motivo_final := CASE WHEN p_tipo = 'bono'
        THEN 'Bono: ' || COALESCE(p_motivo, '')
        ELSE COALESCE(p_motivo, '')
    END;

    FOREACH v_id IN ARRAY p_destinatarios LOOP
        SELECT * INTO v_target FROM public.perfiles WHERE id = v_id;
        v_before := v_target.saldo;
        PERFORM set_config('cuevacoin.trusted_balance_write', '1', true);
        UPDATE public.perfiles SET saldo = saldo + p_monto WHERE id = v_id;
        INSERT INTO public.transacciones(usuario_id, admin_id, tipo, cantidad, saldo_antes, saldo_despues, motivo)
        VALUES(v_id, auth.uid(), 'deposito_admin', p_monto, v_before, v_before + p_monto, v_motivo_final);
        v_mensaje_notif := 'Admin te ha enviado $' || trim(to_char(p_monto, 'FM999999990.00'))
            || CASE WHEN p_tipo = 'bono' THEN ' de bono' ELSE ' de salario' END
            || CASE WHEN p_motivo IS NOT NULL AND p_motivo <> '' THEN ' - Motivo: ' || p_motivo ELSE '' END;
        INSERT INTO public.notificaciones(usuario_id, mensaje, leida, tipo_evento)
        VALUES(v_id, v_mensaje_notif, false, 'pago_admin');
        RETURN QUERY SELECT p.id, p.nombre, p.saldo FROM public.perfiles p WHERE p.id = v_id;
    END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_pagar_salarios_individuales(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pagar_salarios_individuales(jsonb, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_pagar_saldo(uuid[], numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pagar_saldo(uuid[], numeric, text, text) TO authenticated, service_role;

COMMIT;
