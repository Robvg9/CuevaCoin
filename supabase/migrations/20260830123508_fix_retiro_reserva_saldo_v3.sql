DROP FUNCTION IF EXISTS public.admin_resolver_retiro(uuid,text);
DROP FUNCTION IF EXISTS public.solicitar_retiro(numeric,text,text);
CREATE FUNCTION public.solicitar_retiro(p_cantidad numeric,p_idempotency_key text,p_motivo text) RETURNS TABLE(solicitud_id uuid,nuevo_saldo numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u uuid:=auth.uid(); s numeric; est text; adm boolean; sid uuid; eu uuid; ec numeric; em text; ee text; k text:=NULLIF(trim(p_idempotency_key),''); sb numeric;
BEGIN
IF u IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF; IF p_cantidad IS NULL OR p_cantidad<=0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;
SELECT saldo,estado,es_admin INTO s,est,adm FROM perfiles WHERE id=u FOR UPDATE; IF s IS NULL THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF; IF adm THEN RAISE EXCEPTION 'Un admin no solicita retiros'; END IF; IF est IS DISTINCT FROM 'activo' THEN RAISE EXCEPTION 'Tu cuenta está desactivada'; END IF;
IF k IS NOT NULL THEN SELECT id,usuario_id,cantidad,motivo,estado INTO sid,eu,ec,em,ee FROM solicitudes_retiro WHERE idempotency_key=k LIMIT 1; IF sid IS NOT NULL THEN IF eu<>u OR ec IS DISTINCT FROM p_cantidad OR COALESCE(em,'') IS DISTINCT FROM COALESCE(p_motivo,'') THEN RAISE EXCEPTION 'idempotency_key_conflict'; END IF; IF ee='pendiente' THEN RETURN QUERY SELECT sid,s; RETURN; END IF; RAISE EXCEPTION 'idempotency_key_replay'; END IF; END IF;
SELECT id INTO sid FROM solicitudes_retiro WHERE usuario_id=u AND estado='pendiente' ORDER BY creado_en DESC LIMIT 1; IF sid IS NOT NULL THEN IF k IS NULL THEN RETURN QUERY SELECT sid,s; RETURN; END IF; RAISE EXCEPTION 'retiro_pendiente_existente'; END IF;
IF p_cantidad>s THEN RAISE EXCEPTION 'Saldo insuficiente'; END IF; sb:=s;
INSERT INTO solicitudes_retiro(usuario_id,cantidad,motivo,estado,idempotency_key) VALUES(u,p_cantidad,p_motivo,'pendiente',k) RETURNING id INTO sid;
UPDATE perfiles SET saldo=saldo-p_cantidad WHERE id=u RETURNING saldo INTO s;
INSERT INTO transacciones(usuario_id,admin_id,tipo,cantidad,saldo_antes,saldo_despues,motivo) VALUES(u,NULL,'retiro',-p_cantidad,s,s+p_cantidad,'Reserva de retiro pendiente — solicitud '||sid::text);
RETURN QUERY SELECT sid,s; END; $$;
GRANT EXECUTE ON FUNCTION public.solicitar_retiro(numeric,text,text) TO authenticated;
CREATE FUNCTION public.admin_resolver_retiro(p_solicitud_id uuid,p_accion text) RETURNS TABLE(resultado text,nuevo_saldo numeric,usuario_id uuid,usuario_nombre text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE adm boolean; an text; r record; p record; sn numeric; sa numeric;
BEGIN
SELECT es_admin,COALESCE(nombre,usuario) INTO adm,an FROM perfiles WHERE id=auth.uid(); IF adm IS NOT TRUE THEN RAISE EXCEPTION 'Solo un admin puede resolver solicitudes de retiro'; END IF; IF p_accion NOT IN ('aprobar','rechazar') THEN RAISE EXCEPTION 'Acción inválida'; END IF;
SELECT * INTO r FROM solicitudes_retiro WHERE id=p_solicitud_id FOR UPDATE; IF r IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF; IF r.estado<>'pendiente' THEN RAISE EXCEPTION 'ya_no_pendiente'; END IF;
SELECT id,saldo,nombre,usuario INTO p FROM perfiles WHERE id=r.usuario_id FOR UPDATE; IF p IS NULL THEN RAISE EXCEPTION 'Usuario del retiro no encontrado'; END IF;
IF p_accion='aprobar' THEN UPDATE solicitudes_retiro SET estado='aprobado',resuelto_por=auth.uid(),resuelto_en=now() WHERE id=p_solicitud_id; sn:=p.saldo;
INSERT INTO notificaciones(usuario_id,mensaje,leida,tipo_evento) VALUES(r.usuario_id,'Tu solicitud de retiro de $'||trim(to_char(r.cantidad,'FM999999990.00'))||' ha sido aprobada.',false,'retiro_aprobado');
INSERT INTO auditoria(usuario_id,usuario_nombre,accion) VALUES(auth.uid(),an,'Aprobó retiro de $'||trim(to_char(r.cantidad,'FM999999990.00'))||' para '||COALESCE(p.nombre,p.usuario)); RETURN QUERY SELECT 'aprobado'::text,sn,r.usuario_id,COALESCE(p.nombre,p.usuario);
ELSE sa:=p.saldo; UPDATE solicitudes_retiro SET estado='rechazado',resuelto_por=auth.uid(),resuelto_en=now() WHERE id=p_solicitud_id; UPDATE perfiles SET saldo=saldo+r.cantidad WHERE id=r.usuario_id RETURNING saldo INTO sn;
INSERT INTO transacciones(usuario_id,admin_id,tipo,cantidad,saldo_antes,saldo_despues,motivo) VALUES(r.usuario_id,auth.uid(),'retiro',r.cantidad,sa,sn,'Reembolso de retiro rechazado — solicitud '||r.id::text);
INSERT INTO notificaciones(usuario_id,mensaje,leida,tipo_evento) VALUES(r.usuario_id,'Tu solicitud de retiro de $'||trim(to_char(r.cantidad,'FM999999990.00'))||' ha sido rechazada. El monto vuelve a tu saldo disponible.',false,'retiro_rechazado');
INSERT INTO auditoria(usuario_id,usuario_nombre,accion) VALUES(auth.uid(),an,'Rechazó retiro de $'||trim(to_char(r.cantidad,'FM999999990.00'))||' para '||COALESCE(p.nombre,p.usuario)); RETURN QUERY SELECT 'rechazado'::text,sn,r.usuario_id,COALESCE(p.nombre,p.usuario); END IF; END; $$;
GRANT EXECUTE ON FUNCTION public.admin_resolver_retiro(uuid,text) TO authenticated;