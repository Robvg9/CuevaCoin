-- CuevaCoin: evita múltiples retiros pendientes simultáneos por trabajador.
-- Esto protege contra doble toque, reintentos por timeout y reconexiones.
CREATE UNIQUE INDEX IF NOT EXISTS ux_solicitudes_retiro_un_pendiente_por_usuario
ON public.solicitudes_retiro (usuario_id)
WHERE estado = 'pendiente';

-- La función devuelve la solicitud pendiente existente en un reintento,
-- en lugar de crear otra y volver a descontar saldo.
CREATE OR REPLACE FUNCTION public.solicitar_retiro(p_cantidad numeric, p_motivo text)
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
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;

  -- Bloqueo por usuario: todos los reintentos concurrentes se serializan.
  SELECT saldo, estado, es_admin
    INTO v_saldo_actual, v_estado_cuenta, v_es_admin
  FROM perfiles
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

  -- Idempotencia práctica: si el trabajador ya tiene un retiro pendiente,
  -- cualquier reintento devuelve ESA solicitud y su saldo actual.
  -- No se crea una segunda solicitud ni se vuelve a descontar dinero.
  SELECT id INTO v_solicitud_id
  FROM solicitudes_retiro
  WHERE usuario_id = v_usuario_id
    AND estado = 'pendiente'
  ORDER BY creado_en DESC
  LIMIT 1;

  IF v_solicitud_id IS NOT NULL THEN
    RETURN QUERY SELECT v_solicitud_id, v_saldo_actual;
    RETURN;
  END IF;

  IF p_cantidad > v_saldo_actual THEN
    RAISE EXCEPTION 'Saldo insuficiente';
  END IF;

  INSERT INTO solicitudes_retiro (usuario_id, cantidad, motivo, estado)
  VALUES (v_usuario_id, p_cantidad, p_motivo, 'pendiente')
  RETURNING id INTO v_solicitud_id;

  -- El descuento queda dentro de la misma transacción atómica que la
  -- creación de la solicitud. Si algo falla, ambas cosas hacen rollback.
  UPDATE perfiles
  SET saldo = saldo - p_cantidad
  WHERE id = v_usuario_id;

  RETURN QUERY SELECT v_solicitud_id, (v_saldo_actual - p_cantidad);
END;
$function$;