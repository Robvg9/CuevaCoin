-- CuevaCoin: salary movements requested by BattleCruiser.
-- The only caller is the server-side payroll Edge Function.
CREATE TABLE IF NOT EXISTS public.admin_operaciones_nomina_idempotencia (
  idempotency_key uuid PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES public.perfiles(id),
  usuario_id uuid NOT NULL REFERENCES public.perfiles(id),
  tipo text NOT NULL CHECK (tipo IN ('DEPOSITO','RETIRO')),
  cantidad numeric(14,2) NOT NULL CHECK (cantidad > 0),
  motivo text NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 1 AND 500),
  referencia_externa text NOT NULL CHECK (char_length(btrim(referencia_externa)) BETWEEN 1 AND 180),
  saldo_antes numeric(14,2),
  saldo_despues numeric(14,2),
  transaccion_id uuid REFERENCES public.transacciones(id),
  completada boolean NOT NULL DEFAULT false,
  creado_en timestamptz NOT NULL DEFAULT now(),
  completado_en timestamptz,
  CONSTRAINT admin_operaciones_nomina_ref_uq UNIQUE (tipo, referencia_externa)
);
ALTER TABLE public.admin_operaciones_nomina_idempotencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_operaciones_nomina_idempotencia FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_operaciones_nomina_idempotencia TO service_role;

CREATE OR REPLACE FUNCTION public.admin_operar_nomina_integrado(
  p_admin_id uuid,p_usuario_id uuid,p_tipo text,p_cantidad numeric,
  p_motivo text,p_idempotency_key uuid,p_referencia_externa text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
  v_admin public.perfiles%ROWTYPE;
  v_target public.perfiles%ROWTYPE;
  v_op public.admin_operaciones_nomina_idempotencia%ROWTYPE;
  v_delta numeric(14,2);
  v_after numeric(14,2);
  v_tx uuid;
  v_reason text := NULLIF(btrim(coalesce(p_motivo,'')),'');
  v_ref text := NULLIF(btrim(coalesce(p_referencia_externa,'')),'');
  v_message text;
  v_name text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Solo el servicio seguro de nómina puede ejecutar esta operación.' USING ERRCODE='42501';
  END IF;
  IF p_admin_id IS NULL OR p_usuario_id IS NULL OR p_idempotency_key IS NULL
     OR p_tipo NOT IN ('DEPOSITO','RETIRO') OR p_cantidad IS NULL
     OR p_cantidad<=0 OR p_cantidad<>round(p_cantidad,2)
     OR v_reason IS NULL OR length(v_reason)>500
     OR v_ref IS NULL OR length(v_ref)>180 THEN
    RAISE EXCEPTION 'Parámetros de operación salarial inválidos.' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_admin FROM public.perfiles
  WHERE id=p_admin_id AND es_admin=true AND estado='activo' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El administrador de CuevaCoin no está activo.' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.admin_operaciones_nomina_idempotencia
    (idempotency_key,admin_id,usuario_id,tipo,cantidad,motivo,referencia_externa)
  VALUES (p_idempotency_key,p_admin_id,p_usuario_id,p_tipo,p_cantidad,v_reason,v_ref)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_op;

  IF NOT FOUND THEN
    SELECT * INTO v_op FROM public.admin_operaciones_nomina_idempotencia
    WHERE idempotency_key=p_idempotency_key FOR UPDATE;
    IF NOT FOUND
       OR v_op.admin_id IS DISTINCT FROM p_admin_id
       OR v_op.usuario_id IS DISTINCT FROM p_usuario_id
       OR v_op.tipo IS DISTINCT FROM p_tipo
       OR v_op.cantidad IS DISTINCT FROM p_cantidad
       OR v_op.motivo IS DISTINCT FROM v_reason
       OR v_op.referencia_externa IS DISTINCT FROM v_ref THEN
      RAISE EXCEPTION 'La clave de idempotencia ya pertenece a otra operación.' USING ERRCODE='23505';
    END IF;
    IF NOT v_op.completada OR v_op.transaccion_id IS NULL
       OR v_op.saldo_antes IS NULL OR v_op.saldo_despues IS NULL THEN
      RAISE EXCEPTION 'La operación previa quedó incompleta; requiere revisión manual.' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('ok',true,'repetida',true,
      'usuario_id',v_op.usuario_id,'tipo',v_op.tipo,'cantidad',v_op.cantidad,
      'saldo_antes',v_op.saldo_antes,'saldo_despues',v_op.saldo_despues,
      'transaccion_id',v_op.transaccion_id,'referencia_externa',v_op.referencia_externa);
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_operaciones_nomina_idempotencia x
    WHERE x.tipo=p_tipo AND x.referencia_externa=v_ref
      AND x.idempotency_key<>p_idempotency_key) THEN
    RAISE EXCEPTION 'La referencia externa ya fue procesada con otra clave.' USING ERRCODE='23505';
  END IF;

  SELECT * INTO v_target FROM public.perfiles WHERE id=p_usuario_id FOR UPDATE;
  IF NOT FOUND OR v_target.es_dependiente IS DISTINCT FROM true
     OR v_target.es_admin IS DISTINCT FROM false OR v_target.estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'La cuenta destino no es una dependiente activa de CuevaCoin.' USING ERRCODE='42501';
  END IF;

  v_delta:=CASE WHEN p_tipo='DEPOSITO' THEN p_cantidad ELSE -p_cantidad END;
  v_after:=round(v_target.saldo+v_delta,2);
  IF v_after<0 THEN
    RAISE EXCEPTION 'Saldo insuficiente: la operación no puede dejar saldo negativo.' USING ERRCODE='23514';
  END IF;

  PERFORM set_config('cuevacoin.trusted_balance_write','1',true);
  UPDATE public.perfiles SET saldo=v_after WHERE id=p_usuario_id;
  INSERT INTO public.transacciones(usuario_id,admin_id,tipo,cantidad,saldo_antes,saldo_despues,motivo)
  VALUES(p_usuario_id,p_admin_id,
    CASE WHEN p_tipo='DEPOSITO' THEN 'deposito_admin' ELSE 'retiro_admin' END,
    v_delta,v_target.saldo,v_after,v_reason)
  RETURNING id INTO v_tx;

  v_name:=coalesce(nullif(btrim(v_target.nombre),''),v_target.usuario);
  v_message:=CASE WHEN p_tipo='DEPOSITO'
    THEN 'Has recibido un salario de $'||to_char(p_cantidad,'FM999999990.00')||' CUP. '||v_reason||'.'
    ELSE 'Se registró la entrega de $'||to_char(p_cantidad,'FM999999990.00')||' CUP de tu salario acumulado. '||v_reason||'.'
    END;
  INSERT INTO public.notificaciones(usuario_id,mensaje,leida,tipo_evento)
  VALUES(p_usuario_id,v_message,false,CASE WHEN p_tipo='DEPOSITO' THEN 'pago_admin' ELSE 'ajuste_saldo' END);
  INSERT INTO public.auditoria(usuario_id,usuario_nombre,accion)
  VALUES(p_admin_id,coalesce(nullif(btrim(v_admin.nombre),''),v_admin.usuario),
    CASE WHEN p_tipo='DEPOSITO' THEN 'Acreditó salario a ' ELSE 'Registró retiro de salario para ' END
    ||v_name||': $'||to_char(p_cantidad,'FM999999990.00')||' CUP. Referencia BattleCruiser: '||v_ref);

  UPDATE public.admin_operaciones_nomina_idempotencia
  SET saldo_antes=v_target.saldo,saldo_despues=v_after,transaccion_id=v_tx,
      completada=true,completado_en=now()
  WHERE idempotency_key=p_idempotency_key;
  RETURN jsonb_build_object('ok',true,'repetida',false,'usuario_id',p_usuario_id,
    'tipo',p_tipo,'cantidad',p_cantidad,'saldo_antes',v_target.saldo,
    'saldo_despues',v_after,'transaccion_id',v_tx,'referencia_externa',v_ref);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_operar_nomina_integrado(uuid,uuid,text,numeric,text,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_operar_nomina_integrado(uuid,uuid,text,numeric,text,uuid,text)
  TO service_role;
