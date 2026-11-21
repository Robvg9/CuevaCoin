ALTER TABLE public.solicitudes_retiro
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_solicitudes_retiro_idempotency_key
  ON public.solicitudes_retiro (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.solicitar_retiro(
  p_cantidad numeric,
  p_motivo text,
  p_idempotency_key text DEFAULT NULL
)
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
  v_key text := NULLIF(trim(p_idempotency_key), '');
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;

  -- Serializa todas las operaciones de retiro del mismo usuario.
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

  -- Idempotencia: una key representa una única intención lógica.
  -- Se busca globalmente para evitar que una key ya usada por otra cuenta
  -- pueda ser reutilizada como si fuera una operación nueva.
  IF v_key IS NOT NULL THEN
    SELECT id, usuario_id
      INTO v_solicitud_id, v_existing_usuario_id
    FROM public.solicitudes_retiro
    WHERE idempotency_key = v_key
    LIMIT 1;

    IF v_solicitud_id IS NOT NULL THEN
      IF v_existing_usuario_id <> v_usuario_id THEN
        RAISE EXCEPTION 'idempotency_key_conflict';
      END IF;

      -- Mismo intento lógico: devolver exactamente la misma solicitud.
      -- No se modifica saldo ni estado.
      RETURN QUERY SELECT v_solicitud_id, v_saldo_actual;
      RETURN;
    END IF;
  END IF;

  -- Regla de negocio: máximo una solicitud pendiente por usuario.
  -- Con el lock del perfil, las llamadas concurrentes del mismo usuario
  -- quedan serializadas. El índice parcial único aporta defensa adicional.
  SELECT id
    INTO v_solicitud_id
  FROM public.solicitudes_retiro
  WHERE usuario_id = v_usuario_id
    AND estado = 'pendiente'
  ORDER BY creado_en DESC
  LIMIT 1;

  IF v_solicitud_id IS NOT NULL THEN
    IF v_key IS NULL THEN
      -- Compatibilidad durante transición con callers de 2 argumentos.
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

  -- Reserva/descuento y creación quedan en la misma transacción.
  UPDATE public.perfiles
  SET saldo = saldo - p_cantidad
  WHERE id = v_usuario_id
  RETURNING saldo INTO v_saldo_actual;

  RETURN QUERY SELECT v_solicitud_id, v_saldo_actual;
END;
$function$;