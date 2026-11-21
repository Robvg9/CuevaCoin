ALTER TABLE public.solicitudes_retiro
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_solicitudes_retiro_idempotency_key
  ON public.solicitudes_retiro (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.solicitar_retiro(numeric, text);

CREATE OR REPLACE FUNCTION public.solicitar_retiro(
  p_cantidad numeric,
  p_motivo text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS TABLE(solicitud_id uuid, nuevo_saldo numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_saldo_actual numeric;
  v_estado_cuenta text;
  v_es_admin boolean;
  v_solicitud_id uuid;
  v_solicitud_usuario uuid;
  v_key text := NULLIF(btrim(p_idempotency_key), '');
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 OR p_cantidad <> trunc(p_cantidad) THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;

  SELECT p.saldo, p.estado, p.es_admin
    INTO v_saldo_actual, v_estado_cuenta, v_es_admin
  FROM public.perfiles AS p
  WHERE p.id = v_usuario_id
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
    SELECT s.id, s.usuario_id
      INTO v_solicitud_id, v_solicitud_usuario
    FROM public.solicitudes_retiro AS s
    WHERE s.idempotency_key = v_key
    LIMIT 1;

    IF v_solicitud_id IS NOT NULL THEN
      IF v_solicitud_usuario <> v_usuario_id THEN
        RAISE EXCEPTION 'idempotency_key_conflict';
      END IF;

      RETURN QUERY
      SELECT v_solicitud_id, v_saldo_actual;
      RETURN;
    END IF;
  END IF;

  SELECT s.id
    INTO v_solicitud_id
  FROM public.solicitudes_retiro AS s
  WHERE s.usuario_id = v_usuario_id
    AND s.estado = 'pendiente'
  ORDER BY s.creado_en DESC
  LIMIT 1;

  IF v_solicitud_id IS NOT NULL THEN
    RAISE EXCEPTION 'retiro_pendiente_existente';
  END IF;

  IF p_cantidad > v_saldo_actual THEN
    RAISE EXCEPTION 'Saldo insuficiente';
  END IF;

  INSERT INTO public.solicitudes_retiro (
    usuario_id,
    cantidad,
    motivo,
    estado,
    idempotency_key
  )
  VALUES (
    v_usuario_id,
    p_cantidad,
    p_motivo,
    'pendiente',
    v_key
  )
  RETURNING id INTO v_solicitud_id;

  UPDATE public.perfiles
  SET saldo = saldo - p_cantidad
  WHERE id = v_usuario_id;

  RETURN QUERY
  SELECT v_solicitud_id, (v_saldo_actual - p_cantidad);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.solicitar_retiro(numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.solicitar_retiro(numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.solicitar_retiro(numeric, text, text) TO authenticated;