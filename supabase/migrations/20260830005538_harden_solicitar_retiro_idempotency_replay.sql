CREATE OR REPLACE FUNCTION public.solicitar_retiro(p_cantidad numeric, p_motivo text, p_idempotency_key text DEFAULT NULL::text)
RETURNS TABLE(solicitud_id uuid, nuevo_saldo numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_saldo_actual numeric;
  v_estado_cuenta text;
  v_es_admin boolean;
  v_solicitud_id uuid;
  v_existing_usuario_id uuid;
  v_existing_cantidad numeric;
  v_existing_motivo text;
  v_existing_estado text;
  v_key text := NULLIF(trim(p_idempotency_key), '');
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;

  SELECT saldo, estado, es_admin
    INTO v_saldo_actual, v_estado_cuenta, v_es_admin
  FROM public.perfiles
  WHERE id = v_usuario_id
  FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Perfil no encontrado';
  END IF;
  IF v_es_admin THEN
    RAISE EXCEPTION 'Un admin no solicita retiros';
  END IF;
  IF v_estado_cuenta IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'Tu cuenta está desactivada';
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT id, usuario_id, cantidad, motivo, estado
      INTO v_solicitud_id, v_existing_usuario_id, v_existing_cantidad, v_existing_motivo, v_existing_estado
    FROM public.solicitudes_retiro
    WHERE idempotency_key = v_key
    LIMIT 1;

    IF v_solicitud_id IS NOT NULL THEN
      IF v_existing_usuario_id <> v_usuario_id THEN
        RAISE EXCEPTION 'idempotency_key_conflict';
      END IF;

      IF v_existing_cantidad IS DISTINCT FROM p_cantidad
         OR COALESCE(v_existing_motivo, '') IS DISTINCT FROM COALESCE(p_motivo, '') THEN
        RAISE EXCEPTION 'idempotency_key_conflict';
      END IF;

      IF v_existing_estado = 'pendiente' THEN
        RETURN QUERY SELECT v_solicitud_id, v_saldo_actual;
        RETURN;
      END IF;

      RAISE EXCEPTION 'idempotency_key_replay';
    END IF;
  END IF;

  SELECT id
    INTO v_solicitud_id
  FROM public.solicitudes_retiro
  WHERE usuario_id = v_usuario_id
    AND estado = 'pendiente'
  ORDER BY creado_en DESC
  LIMIT 1;

  IF v_solicitud_id IS NOT NULL THEN
    IF v_key IS NULL THEN
      RETURN QUERY SELECT v_solicitud_id, v_saldo_actual;
      RETURN;
    END IF;

    RAISE EXCEPTION 'retiro_pendiente_existente';
  END IF;

  IF p_cantidad > v_saldo_actual THEN
    RAISE EXCEPTION 'Saldo insuficiente';
  END IF;

  INSERT INTO public.solicitudes_retiro
    (usuario_id, cantidad, motivo, estado, idempotency_key)
  VALUES
    (v_usuario_id, p_cantidad, p_motivo, 'pendiente', v_key)
  RETURNING id INTO v_solicitud_id;

  UPDATE public.perfiles
  SET saldo = saldo - p_cantidad
  WHERE id = v_usuario_id
  RETURNING saldo INTO v_saldo_actual;

  RETURN QUERY SELECT v_solicitud_id, v_saldo_actual;
END;
$function$;