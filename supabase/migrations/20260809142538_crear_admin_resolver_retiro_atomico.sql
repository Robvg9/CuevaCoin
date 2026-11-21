CREATE OR REPLACE FUNCTION public.admin_resolver_retiro(p_solicitud_id uuid, p_accion text)
RETURNS TABLE(estado text, nuevo_saldo numeric, usuario_id uuid, usuario_nombre text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_soy_admin boolean;
  v_admin_nombre text;
  v_solicitud record;
  v_perfil record;
  v_saldo_antes numeric;
  v_saldo_despues numeric;
BEGIN
  SELECT es_admin, COALESCE(nombre, usuario) INTO v_soy_admin, v_admin_nombre
  FROM perfiles WHERE id = auth.uid();
  IF v_soy_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo un admin puede resolver solicitudes de retiro';
  END IF;
  IF p_accion NOT IN ('aprobar', 'rechazar') THEN
    RAISE EXCEPTION 'Acción inválida';
  END IF;

  -- Bloquea la fila de la solicitud para evitar doble-click / doble
  -- resolución desde 2 pestañas a la vez (mismo bug que ya se había
  -- parchado a medias con la guardia .eq('estado','pendiente') del
  -- cliente, ahora resuelto de raíz con un lock real).
  SELECT * INTO v_solicitud FROM solicitudes_retiro WHERE id = p_solicitud_id FOR UPDATE;
  IF v_solicitud IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  IF v_solicitud.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'ya_no_pendiente';
  END IF;

  -- Bloquea la fila del perfil del trabajador para que el saldo no
  -- pueda cambiar por otra operación concurrente mientras se resuelve.
  SELECT id, saldo, nombre, usuario INTO v_perfil
  FROM perfiles WHERE id = v_solicitud.usuario_id FOR UPDATE;
  IF v_perfil IS NULL THEN
    RAISE EXCEPTION 'Usuario del retiro no encontrado';
  END IF;

  IF p_accion = 'aprobar' THEN
    UPDATE solicitudes_retiro
    SET estado = 'aprobado', resuelto_por = auth.uid(), resuelto_en = now()
    WHERE id = p_solicitud_id;

    -- El monto ya se reservó/descontó de perfiles.saldo al momento de
    -- solicitar el retiro (ver retiro-form submit) - acá NO se vuelve a
    -- descontar, solo se registra la transacción histórica.
    v_saldo_despues := v_perfil.saldo;
    v_saldo_antes := v_saldo_despues + v_solicitud.cantidad;

    INSERT INTO transacciones (usuario_id, admin_id, tipo, cantidad, saldo_antes, saldo_despues, motivo)
    VALUES (v_solicitud.usuario_id, auth.uid(), 'retiro', -v_solicitud.cantidad, v_saldo_antes, v_saldo_despues, 'Retiro aprobado por admin');

    INSERT INTO notificaciones (usuario_id, mensaje, leida, tipo_evento)
    VALUES (v_solicitud.usuario_id, 'Tu solicitud de retiro de $' || trim(to_char(v_solicitud.cantidad, 'FM999999990.00')) || ' ha sido aprobada.', false, 'retiro_aprobado');

    INSERT INTO auditoria (usuario_id, usuario_nombre, accion)
    VALUES (auth.uid(), v_admin_nombre, 'Aprobó retiro de $' || trim(to_char(v_solicitud.cantidad, 'FM999999990.00')) || ' para ' || COALESCE(v_perfil.nombre, v_perfil.usuario));

    RETURN QUERY SELECT 'aprobado'::text, v_saldo_despues, v_solicitud.usuario_id, COALESCE(v_perfil.nombre, v_perfil.usuario);
  ELSE
    UPDATE solicitudes_retiro
    SET estado = 'rechazado', resuelto_por = auth.uid(), resuelto_en = now()
    WHERE id = p_solicitud_id;

    -- Se devuelve el monto reservado, ahora protegido por el lock de
    -- arriba (antes era un SELECT + UPDATE separados del lado del
    -- cliente, con ventana de carrera entre ambos pasos).
    UPDATE perfiles SET saldo = saldo + v_solicitud.cantidad WHERE id = v_solicitud.usuario_id
    RETURNING saldo INTO v_saldo_despues;

    INSERT INTO notificaciones (usuario_id, mensaje, leida, tipo_evento)
    VALUES (v_solicitud.usuario_id, 'Tu solicitud de retiro de $' || trim(to_char(v_solicitud.cantidad, 'FM999999990.00')) || ' ha sido rechazada. El monto vuelve a tu saldo disponible.', false, 'retiro_rechazado');

    INSERT INTO auditoria (usuario_id, usuario_nombre, accion)
    VALUES (auth.uid(), v_admin_nombre, 'Rechazó retiro de $' || trim(to_char(v_solicitud.cantidad, 'FM999999990.00')) || ' para ' || COALESCE(v_perfil.nombre, v_perfil.usuario));

    RETURN QUERY SELECT 'rechazado'::text, v_saldo_despues, v_solicitud.usuario_id, COALESCE(v_perfil.nombre, v_perfil.usuario);
  END IF;
END;
$function$;