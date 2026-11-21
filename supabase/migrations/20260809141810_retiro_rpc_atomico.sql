-- FIX-SEGURIDAD-1 (2026-08-09): antes, "solicitar retiro" y
-- "aprobar/rechazar retiro" hacían leer-saldo-y-luego-escribir en 2
-- pasos separados desde el navegador (retiro-form submit,
-- ejecutarAccionDeCola, aprobarSolicitud, rechazarSolicitud) - eso es
-- una condición de carrera real: dos solicitudes casi simultáneas del
-- mismo usuario (dos pestañas/dispositivos, doble tap) podían leer el
-- mismo saldo antes de que la primera terminara de escribir, y la
-- segunda pisaba el resultado de la primera. Estas 2 funciones mueven
-- la lógica de dinero al servidor con bloqueo de fila (FOR UPDATE),
-- mismo patrón que la función admin_pagar_saldo que ya existía.

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

  -- FOR UPDATE: bloquea la fila hasta que termine esta transacción, así
  -- una segunda solicitud concurrente del mismo usuario tiene que
  -- esperar a que esta termine (y ve el saldo YA descontado), en vez de
  -- leer el saldo viejo en paralelo.
  SELECT saldo, estado, es_admin INTO v_saldo_actual, v_estado_cuenta, v_es_admin
  FROM perfiles WHERE id = v_usuario_id FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Perfil no encontrado';
  END IF;
  IF v_es_admin THEN
    RAISE EXCEPTION 'Un admin no solicita retiros';
  END IF;
  IF v_estado_cuenta IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'Tu cuenta está desactivada';
  END IF;
  IF p_cantidad > v_saldo_actual THEN
    RAISE EXCEPTION 'Saldo insuficiente';
  END IF;

  INSERT INTO solicitudes_retiro (usuario_id, cantidad, motivo, estado)
  VALUES (v_usuario_id, p_cantidad, p_motivo, 'pendiente')
  RETURNING id INTO v_solicitud_id;

  UPDATE perfiles SET saldo = saldo - p_cantidad WHERE id = v_usuario_id;

  RETURN QUERY SELECT v_solicitud_id, (v_saldo_actual - p_cantidad);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolver_retiro(p_solicitud_id uuid, p_aprobar boolean)
RETURNS TABLE(usuario_id uuid, nombre text, usuario_nombre_usuario text, nuevo_saldo numeric, cantidad numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_soy_admin boolean;
  v_solicitud record;
  v_saldo_actual numeric;
  v_saldo_nuevo numeric;
  v_nombre_usuario text;
  v_usuario_col text;
  v_mensaje text;
BEGIN
  SELECT es_admin INTO v_soy_admin FROM perfiles WHERE id = v_admin_id;
  IF v_soy_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo un admin puede resolver retiros';
  END IF;

  -- Bloquea la fila de la solicitud: si dos admins (o el mismo admin con
  -- doble clic) intentan resolverla a la vez, el segundo espera, ve
  -- estado != 'pendiente' y falla limpio en vez de procesarla 2 veces.
  SELECT * INTO v_solicitud FROM solicitudes_retiro WHERE id = p_solicitud_id AND estado = 'pendiente' FOR UPDATE;
  IF v_solicitud IS NULL THEN
    RAISE EXCEPTION 'Esta solicitud ya no está pendiente';
  END IF;

  SELECT saldo, nombre, usuario INTO v_saldo_actual, v_nombre_usuario, v_usuario_col
  FROM perfiles WHERE id = v_solicitud.usuario_id FOR UPDATE;

  IF p_aprobar THEN
    UPDATE solicitudes_retiro SET estado = 'aprobado', resuelto_por = v_admin_id, resuelto_en = now()
    WHERE id = p_solicitud_id;

    -- El monto ya estaba reservado/descontado desde solicitar_retiro, acá
    -- NO se vuelve a tocar el saldo - solo se registra la transacción.
    v_saldo_nuevo := v_saldo_actual;
    INSERT INTO transacciones (usuario_id, admin_id, tipo, cantidad, saldo_antes, saldo_despues, motivo)
    VALUES (v_solicitud.usuario_id, v_admin_id, 'retiro', -v_solicitud.cantidad, v_saldo_actual + v_solicitud.cantidad, v_saldo_actual, 'Retiro aprobado por admin');

    v_mensaje := 'Tu solicitud de retiro de $' || trim(to_char(v_solicitud.cantidad, 'FM999999990.00')) || ' ha sido aprobada.';
    INSERT INTO notificaciones (usuario_id, mensaje, leida, tipo_evento)
    VALUES (v_solicitud.usuario_id, v_mensaje, false, 'retiro_aprobado');

    INSERT INTO auditoria (usuario_id, usuario_nombre, accion)
    VALUES (v_admin_id, (SELECT nombre FROM perfiles WHERE id = v_admin_id), 'Aprobó retiro de $' || trim(to_char(v_solicitud.cantidad, 'FM999999990.00')) || ' para ' || COALESCE(v_nombre_usuario, v_usuario_col));
  ELSE
    UPDATE solicitudes_retiro SET estado = 'rechazado', resuelto_por = v_admin_id, resuelto_en = now()
    WHERE id = p_solicitud_id;

    -- Devolver el monto reservado.
    v_saldo_nuevo := v_saldo_actual + v_solicitud.cantidad;
    UPDATE perfiles SET saldo = v_saldo_nuevo WHERE id = v_solicitud.usuario_id;

    v_mensaje := 'Tu solicitud de retiro de $' || trim(to_char(v_solicitud.cantidad, 'FM999999990.00')) || ' ha sido rechazada. El monto vuelve a tu saldo disponible.';
    INSERT INTO notificaciones (usuario_id, mensaje, leida, tipo_evento)
    VALUES (v_solicitud.usuario_id, v_mensaje, false, 'retiro_rechazado');

    INSERT INTO auditoria (usuario_id, usuario_nombre, accion)
    VALUES (v_admin_id, (SELECT nombre FROM perfiles WHERE id = v_admin_id), 'Rechazó retiro de $' || trim(to_char(v_solicitud.cantidad, 'FM999999990.00')) || ' para ' || COALESCE(v_nombre_usuario, v_usuario_col));
  END IF;

  RETURN QUERY SELECT v_solicitud.usuario_id, v_nombre_usuario, v_usuario_col, v_saldo_nuevo, v_solicitud.cantidad;
END;
$function$;
