-- Forward-only hardening applied to CuevaCoin LIVE on 2026-11-21.
-- Git filename aligned to the Supabase migration registry version on 2026-11-22.
-- LIVE registry: 20261121124522; stored statement: 9,174 normalized characters.
-- Stored statement MD5: 2b07ab98ef1814b936d3b21252367bdc.
-- The executable SQL matches LIVE; repository differences are comments/whitespace only.
-- This migration is already applied. Never replay it against the LIVE project.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_resolver_retiro(p_solicitud_id uuid, p_aprobar boolean)
 RETURNS TABLE(usuario_id uuid, nombre text, usuario_nombre_usuario text, nuevo_saldo numeric, cantidad numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_admin_id uuid:=auth.uid(); v_soy_admin boolean; v_admin_estado text; v_solicitud record; v_saldo_actual numeric; v_saldo_nuevo numeric; v_nombre_usuario text; v_usuario_col text; v_mensaje text;
BEGIN
  SELECT es_admin, estado INTO v_soy_admin, v_admin_estado FROM public.perfiles WHERE id=v_admin_id; IF v_soy_admin IS NOT TRUE OR v_admin_estado IS DISTINCT FROM 'activo' THEN RAISE EXCEPTION 'Solo un administrador activo puede resolver retiros'; END IF;
  SELECT * INTO v_solicitud FROM solicitudes_retiro WHERE id=p_solicitud_id AND estado='pendiente' FOR UPDATE; IF v_solicitud IS NULL THEN RAISE EXCEPTION 'Esta solicitud ya no está pendiente'; END IF;
  SELECT saldo,nombre,usuario INTO v_saldo_actual,v_nombre_usuario,v_usuario_col FROM perfiles WHERE id=v_solicitud.usuario_id FOR UPDATE;
  IF p_aprobar THEN
    UPDATE solicitudes_retiro SET estado='aprobado',resuelto_por=v_admin_id,resuelto_en=now() WHERE id=p_solicitud_id;
    v_saldo_nuevo:=v_saldo_actual;
    INSERT INTO transacciones(usuario_id,admin_id,tipo,cantidad,saldo_antes,saldo_despues,motivo)
      VALUES(v_solicitud.usuario_id,v_admin_id,'retiro',-v_solicitud.cantidad,v_saldo_actual,v_saldo_actual,'Retiro aprobado por admin');
    v_mensaje:='Tu solicitud de retiro de $'||trim(to_char(v_solicitud.cantidad,'FM999999990.00'))||' ha sido aprobada.';
    INSERT INTO notificaciones(usuario_id,mensaje,leida,tipo_evento) VALUES(v_solicitud.usuario_id,v_mensaje,false,'retiro_aprobado');
    INSERT INTO auditoria(usuario_id,usuario_nombre,accion) VALUES(v_admin_id,(SELECT nombre FROM perfiles WHERE id=v_admin_id),'Aprobó retiro de $'||trim(to_char(v_solicitud.cantidad,'FM999999990.00'))||' para '||COALESCE(v_nombre_usuario,v_usuario_col));
  ELSE
    v_saldo_nuevo:=v_saldo_actual+v_solicitud.cantidad;
    PERFORM set_config('cuevacoin.trusted_balance_write','1',true);
    UPDATE perfiles SET saldo=v_saldo_nuevo WHERE id=v_solicitud.usuario_id;
    UPDATE solicitudes_retiro SET estado='rechazado',resuelto_por=v_admin_id,resuelto_en=now() WHERE id=p_solicitud_id;
    INSERT INTO transacciones(usuario_id,admin_id,tipo,cantidad,saldo_antes,saldo_despues,motivo)
      VALUES(v_solicitud.usuario_id,v_admin_id,'retiro',v_solicitud.cantidad,v_saldo_actual,v_saldo_nuevo,'Reembolso de retiro rechazado — solicitud '||v_solicitud.id::text);
    v_mensaje:='Tu solicitud de retiro de $'||trim(to_char(v_solicitud.cantidad,'FM999999990.00'))||' ha sido rechazada. El monto vuelve a tu saldo disponible.';
    INSERT INTO notificaciones(usuario_id,mensaje,leida,tipo_evento) VALUES(v_solicitud.usuario_id,v_mensaje,false,'retiro_rechazado');
    INSERT INTO auditoria(usuario_id,usuario_nombre,accion) VALUES(v_admin_id,(SELECT nombre FROM perfiles WHERE id=v_admin_id),'Rechazó retiro de $'||trim(to_char(v_solicitud.cantidad,'FM999999990.00'))||' para '||COALESCE(v_nombre_usuario,v_usuario_col));
  END IF;
  RETURN QUERY SELECT v_solicitud.usuario_id,v_nombre_usuario,v_usuario_col,v_saldo_nuevo,v_solicitud.cantidad;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_resolver_retiro(p_solicitud_id uuid, p_accion text)
 RETURNS TABLE(resultado text, nuevo_saldo numeric, usuario_id uuid, usuario_nombre text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    adm boolean;
    admin_estado text;
    an text;
    r record;
    p record;
    sn numeric;
    sa numeric;
BEGIN
    SELECT es_admin, estado, COALESCE(nombre, usuario)
      INTO adm, admin_estado, an
      FROM public.perfiles
     WHERE id = auth.uid();

    IF adm IS NOT TRUE OR admin_estado IS DISTINCT FROM 'activo' THEN
        RAISE EXCEPTION 'Solo un administrador activo puede resolver retiros';
    END IF;
    IF p_accion NOT IN ('aprobar', 'rechazar') THEN
        RAISE EXCEPTION 'Acción inválida';
    END IF;

    SELECT * INTO r
      FROM public.solicitudes_retiro
     WHERE id = p_solicitud_id
     FOR UPDATE;
    IF r IS NULL THEN
        RAISE EXCEPTION 'Solicitud no encontrada';
    END IF;
    IF r.estado <> 'pendiente' THEN
        RAISE EXCEPTION 'ya_no_pendiente';
    END IF;

    SELECT id, saldo, nombre, usuario
      INTO p
      FROM public.perfiles
     WHERE id = r.usuario_id
     FOR UPDATE;
    IF p IS NULL THEN
        RAISE EXCEPTION 'Usuario del retiro no encontrado';
    END IF;

    IF p_accion = 'aprobar' THEN
        UPDATE public.solicitudes_retiro
           SET estado = 'aprobado',
               resuelto_por = auth.uid(),
               resuelto_en = now()
         WHERE id = p_solicitud_id;
        sn := p.saldo;

        INSERT INTO public.notificaciones(usuario_id, mensaje, leida, tipo_evento)
        VALUES (
            r.usuario_id,
            'Tu solicitud de retiro de $' || trim(to_char(r.cantidad, 'FM999999990.00')) || ' ha sido aprobada.',
            false,
            'retiro_aprobado'
        );
        INSERT INTO public.auditoria(usuario_id, usuario_nombre, accion)
        VALUES (
            auth.uid(),
            an,
            'Aprobó retiro de $' || trim(to_char(r.cantidad, 'FM999999990.00')) ||
            ' para ' || COALESCE(p.nombre, p.usuario)
        );
        RETURN QUERY SELECT 'aprobado'::text, sn, r.usuario_id, COALESCE(p.nombre, p.usuario);
        RETURN;
    END IF;

    sa := p.saldo;
    UPDATE public.solicitudes_retiro
       SET estado = 'rechazado',
           resuelto_por = auth.uid(),
           resuelto_en = now()
     WHERE id = p_solicitud_id;

    PERFORM set_config('cuevacoin.trusted_balance_write', '1', true);
    UPDATE public.perfiles
       SET saldo = saldo + r.cantidad
     WHERE id = r.usuario_id
     RETURNING saldo INTO sn;

    INSERT INTO public.transacciones(usuario_id, admin_id, tipo, cantidad, saldo_antes, saldo_despues, motivo)
    VALUES (
        r.usuario_id, auth.uid(), 'retiro', r.cantidad, sa, sn,
        'Reembolso de retiro rechazado — solicitud ' || r.id::text
    );
    INSERT INTO public.notificaciones(usuario_id, mensaje, leida, tipo_evento)
    VALUES (
        r.usuario_id,
        'Tu solicitud de retiro de $' || trim(to_char(r.cantidad, 'FM999999990.00')) ||
        ' ha sido rechazada. El monto vuelve a tu saldo disponible.',
        false,
        'retiro_rechazado'
    );
    INSERT INTO public.auditoria(usuario_id, usuario_nombre, accion)
    VALUES (
        auth.uid(),
        an,
        'Rechazó retiro de $' || trim(to_char(r.cantidad, 'FM999999990.00')) ||
        ' para ' || COALESCE(p.nombre, p.usuario)
    );

    RETURN QUERY SELECT 'rechazado'::text, sn, r.usuario_id, COALESCE(p.nombre, p.usuario);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resolver_destinatario_transferencia_v2(p_identificador text)
RETURNS TABLE(id uuid, usuario text, nombre text, apellido text, estado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v text := NULLIF(trim(p_identificador), '');
  v_lc text;
  v_name_matches integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF v IS NULL THEN RAISE EXCEPTION 'Identificador requerido'; END IF;
  v_lc := lower(v);

  -- Exact username/email is unambiguous. A display name may not be:
  -- never select an arbitrary account when several active profiles share it.
  IF NOT EXISTS (
    SELECT 1
    FROM public.perfiles p
    WHERE p.estado = 'activo'
      AND p.es_admin = false
      AND (
        lower(trim(p.usuario)) = v_lc
        OR lower(trim(p.correo)) = v_lc
      )
  ) THEN
    SELECT count(*) INTO v_name_matches
    FROM public.perfiles p
    WHERE p.estado = 'activo'
      AND p.es_admin = false
      AND lower(trim(p.nombre)) = v_lc;

    IF v_name_matches > 1 THEN
      RAISE EXCEPTION 'Nombre ambiguo. Busca por usuario o correo electrónico.';
    END IF;
  END IF;

  RETURN QUERY
  SELECT p.id, p.usuario, p.nombre, p.apellido, p.estado
  FROM public.perfiles p
  WHERE p.estado = 'activo'
    AND p.es_admin = false
    AND (
      lower(trim(p.usuario)) = v_lc
      OR lower(trim(p.correo)) = v_lc
      OR lower(trim(p.nombre)) = v_lc
    )
  ORDER BY CASE
    WHEN lower(trim(p.usuario)) = v_lc THEN 0
    WHEN lower(trim(p.correo)) = v_lc THEN 1
    WHEN lower(trim(p.nombre)) = v_lc THEN 2
    ELSE 3
  END, p.id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe ninguna cuenta con ese usuario, nombre o correo electrónico';
  END IF;
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.resolver_destinatario_transferencia_v2(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_destinatario_transferencia_v2(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.resolver_destinatario_transferencia_v2(text)
IS 'Resuelve un identificador y devuelve ID/nombre visibles; nunca devuelve correo electrónico.';

COMMIT;
