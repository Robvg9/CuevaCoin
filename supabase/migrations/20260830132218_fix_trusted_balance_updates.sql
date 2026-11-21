CREATE OR REPLACE FUNCTION public.proteger_columnas_sensibles_perfil()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT (
    public.es_admin()
    OR auth.role() = 'service_role'
    OR current_setting('cuevacoin.trusted_balance_write', true) = '1'
  ) THEN
    NEW.saldo := OLD.saldo;
    NEW.es_admin := OLD.es_admin;
    NEW.estado := OLD.estado;
    NEW.numero_cuenta := OLD.numero_cuenta;
    NEW.usuario := OLD.usuario;
    NEW.correo_verificado := OLD.correo_verificado;
    NEW.fecha_limite_verificacion := OLD.fecha_limite_verificacion;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.solicitar_retiro(p_cantidad numeric, p_idempotency_key text, p_motivo text)
RETURNS TABLE(solicitud_id uuid, nuevo_saldo numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  u uuid := auth.uid(); s numeric; est text; adm boolean; sid uuid;
  eu uuid; ec numeric; em text; ee text; k text := NULLIF(trim(p_idempotency_key), ''); sb numeric;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;
  SELECT saldo, estado, es_admin INTO s, est, adm FROM public.perfiles WHERE id=u FOR UPDATE;
  IF s IS NULL THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;
  IF adm THEN RAISE EXCEPTION 'Un admin no solicita retiros'; END IF;
  IF est IS DISTINCT FROM 'activo' THEN RAISE EXCEPTION 'Tu cuenta está desactivada'; END IF;
  IF k IS NOT NULL THEN
    SELECT id,usuario_id,cantidad,motivo,estado INTO sid,eu,ec,em,ee FROM public.solicitudes_retiro WHERE idempotency_key=k LIMIT 1;
    IF sid IS NOT NULL THEN
      IF eu<>u OR ec IS DISTINCT FROM p_cantidad OR COALESCE(em,'') IS DISTINCT FROM COALESCE(p_motivo,'') THEN RAISE EXCEPTION 'idempotency_key_conflict'; END IF;
      IF ee='pendiente' THEN RETURN QUERY SELECT sid,s; RETURN; END IF;
      RAISE EXCEPTION 'idempotency_key_replay';
    END IF;
  END IF;
  SELECT id INTO sid FROM public.solicitudes_retiro WHERE usuario_id=u AND estado='pendiente' ORDER BY creado_en DESC LIMIT 1;
  IF sid IS NOT NULL THEN
    IF k IS NULL THEN RETURN QUERY SELECT sid,s; RETURN; END IF;
    RAISE EXCEPTION 'retiro_pendiente_existente';
  END IF;
  IF p_cantidad>s THEN RAISE EXCEPTION 'Saldo insuficiente'; END IF;
  sb := s;
  INSERT INTO public.solicitudes_retiro(usuario_id,cantidad,motivo,estado,idempotency_key) VALUES(u,p_cantidad,p_motivo,'pendiente',k) RETURNING id INTO sid;
  PERFORM set_config('cuevacoin.trusted_balance_write','1',true);
  UPDATE public.perfiles SET saldo=saldo-p_cantidad WHERE id=u RETURNING saldo INTO s;
  INSERT INTO public.transacciones(usuario_id,admin_id,tipo,cantidad,saldo_antes,saldo_despues,motivo)
    VALUES(u,NULL,'retiro',-p_cantidad,sb,s,'Reserva de retiro pendiente — solicitud '||sid::text);
  RETURN QUERY SELECT sid,s;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolver_retiro(p_solicitud_id uuid, p_aprobar boolean)
RETURNS TABLE(usuario_id uuid, nombre text, usuario_nombre_usuario text, nuevo_saldo numeric, cantidad numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_admin_id uuid:=auth.uid(); v_soy_admin boolean; v_solicitud record; v_saldo_actual numeric; v_saldo_nuevo numeric; v_nombre_usuario text; v_usuario_col text; v_mensaje text;
BEGIN
  SELECT es_admin INTO v_soy_admin FROM perfiles WHERE id=v_admin_id; IF v_soy_admin IS NOT TRUE THEN RAISE EXCEPTION 'Solo un admin puede resolver retiros'; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_pagar_saldo(p_destinatarios uuid[],p_monto numeric,p_motivo text,p_tipo text)
RETURNS TABLE(usuario_id uuid,nombre text,nuevo_saldo numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_soy_admin boolean; v_saldo_actual numeric; v_id uuid; v_motivo_final text; v_mensaje_notif text;
BEGIN
  SELECT es_admin INTO v_soy_admin FROM perfiles WHERE id=auth.uid(); IF v_soy_admin IS NOT TRUE THEN RAISE EXCEPTION 'Solo un admin puede pagar saldo'; END IF;
  IF p_monto IS NULL OR p_monto<=0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;
  IF p_tipo NOT IN ('salario','bono') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  v_motivo_final:=CASE WHEN p_tipo='bono' THEN 'Bono: '||COALESCE(p_motivo,'') ELSE COALESCE(p_motivo,'') END;
  FOREACH v_id IN ARRAY p_destinatarios LOOP
    SELECT saldo INTO v_saldo_actual FROM perfiles WHERE id=v_id AND es_admin=false FOR UPDATE;
    IF v_saldo_actual IS NULL THEN CONTINUE; END IF;
    PERFORM set_config('cuevacoin.trusted_balance_write','1',true);
    UPDATE perfiles SET saldo=saldo+p_monto WHERE id=v_id;
    INSERT INTO transacciones(usuario_id,admin_id,tipo,cantidad,saldo_antes,saldo_despues,motivo) VALUES(v_id,auth.uid(),'deposito_admin',p_monto,v_saldo_actual,v_saldo_actual+p_monto,v_motivo_final);
    v_mensaje_notif:='Admin te ha enviado $'||trim(to_char(p_monto,'FM999999990.00'))||CASE WHEN p_tipo='bono' THEN ' de bono' ELSE ' de salario' END||CASE WHEN p_motivo IS NOT NULL AND p_motivo<>'' THEN ' - Motivo: '||p_motivo ELSE '' END;
    INSERT INTO notificaciones(usuario_id,mensaje,leida,tipo_evento) VALUES(v_id,v_mensaje_notif,false,'pago_admin');
    RETURN QUERY SELECT p.id,p.nombre,p.saldo FROM perfiles p WHERE p.id=v_id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.transferir_saldo_atomica(p_destinatario_id uuid,p_cantidad numeric,p_motivo text DEFAULT 'Transferencia'::text,p_idempotency_key text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_emisor public.perfiles%ROWTYPE; v_dest public.perfiles%ROWTYPE; v_prev public.transferencias_idempotencia%ROWTYPE; v_nuevo_emisor numeric; v_motivo text:=COALESCE(NULLIF(trim(p_motivo),''),'Transferencia');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_cantidad IS NULL OR p_cantidad<=0 OR p_cantidad<>trunc(p_cantidad) THEN RAISE EXCEPTION 'La cantidad debe ser un entero mayor que 0'; END IF;
  IF p_destinatario_id IS NULL OR p_destinatario_id=auth.uid() THEN RAISE EXCEPTION 'Destinatario inválido'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key))=0 THEN RAISE EXCEPTION 'Idempotency key requerida'; END IF;
  SELECT * INTO v_prev FROM transferencias_idempotencia WHERE idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_prev.emisor_id<>auth.uid() OR v_prev.destinatario_id<>p_destinatario_id OR v_prev.cantidad<>p_cantidad OR v_prev.motivo<>v_motivo THEN RAISE EXCEPTION 'La idempotency key ya fue utilizada con un payload diferente'; END IF;
    RETURN jsonb_build_object('success',true,'nuevoSaldo',v_prev.nuevo_saldo_emisor,'idempotent',true);
  END IF;
  IF auth.uid()<p_destinatario_id THEN
    SELECT * INTO v_emisor FROM perfiles WHERE id=auth.uid() FOR UPDATE; SELECT * INTO v_dest FROM perfiles WHERE id=p_destinatario_id FOR UPDATE;
  ELSE
    SELECT * INTO v_dest FROM perfiles WHERE id=p_destinatario_id FOR UPDATE; SELECT * INTO v_emisor FROM perfiles WHERE id=auth.uid() FOR UPDATE;
  END IF;
  IF v_emisor.id IS NULL THEN RAISE EXCEPTION 'No se pudo verificar tu cuenta'; END IF; IF v_dest.id IS NULL THEN RAISE EXCEPTION 'No existe el destinatario'; END IF;
  IF v_emisor.estado<>'activo' THEN RAISE EXCEPTION 'Tu cuenta no está activa'; END IF; IF v_dest.estado<>'activo' THEN RAISE EXCEPTION 'El destinatario no está activo'; END IF;
  IF v_emisor.saldo<p_cantidad THEN RAISE EXCEPTION 'Saldo insuficiente'; END IF;
  v_nuevo_emisor:=v_emisor.saldo-p_cantidad;
  PERFORM set_config('cuevacoin.trusted_balance_write','1',true);
  UPDATE perfiles SET saldo=v_nuevo_emisor WHERE id=v_emisor.id;
  UPDATE perfiles SET saldo=saldo+p_cantidad WHERE id=v_dest.id;
  INSERT INTO transacciones(usuario_id,contraparte_id,tipo,cantidad,saldo_antes,saldo_despues,motivo) VALUES(v_emisor.id,v_dest.id,'transferencia',-p_cantidad,v_emisor.saldo,v_nuevo_emisor,'Transferencia a '||COALESCE(v_dest.nombre,v_dest.usuario)||': '||v_motivo),(v_dest.id,v_emisor.id,'transferencia',p_cantidad,v_dest.saldo,v_dest.saldo+p_cantidad,'Transferencia recibida de '||COALESCE(v_emisor.nombre,v_emisor.usuario)||': '||v_motivo);
  INSERT INTO transferencias_idempotencia(idempotency_key,emisor_id,destinatario_id,cantidad,motivo,nuevo_saldo_emisor) VALUES(p_idempotency_key,v_emisor.id,v_dest.id,p_cantidad,v_motivo,v_nuevo_emisor);
  RETURN jsonb_build_object('success',true,'nuevoSaldo',v_nuevo_emisor,'idempotent',false);
END;
$function$;