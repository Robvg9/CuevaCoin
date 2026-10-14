-- CuevaCoin Step 10 follow-up — enforce trusted-only balance mutation.
-- This is required because the legacy UI used direct profile UPDATE + ledger insert.
-- After the new V.137 UI, direct balance updates fail closed; finance RPCs explicitly
-- set cuevacoin.trusted_balance_write within their transaction.
BEGIN;

CREATE OR REPLACE FUNCTION public.proteger_columnas_sensibles_perfil()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
    -- Even authenticated admins cannot change saldo directly through PostgREST.
    -- All balance mutations must originate from audited atomic/financial RPCs.
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('cuevacoin.trusted_balance_write', true) IS DISTINCT FROM '1'
       AND NEW.saldo IS DISTINCT FROM OLD.saldo THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'saldo_update_requires_atomic_rpc';
    END IF;

    -- Preserve existing admin/service-role exceptions for other protected fields.
    IF NOT (
        public.es_admin()
        OR auth.role() = 'service_role'
        OR current_setting('cuevacoin.trusted_balance_write', true) = '1'
    ) THEN
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

CREATE OR REPLACE FUNCTION public.admin_ajustar_saldo_atomico(
    p_usuario_id uuid,
    p_tipo text,
    p_cantidad numeric,
    p_motivo text,
    p_idempotency_key uuid
)
RETURNS TABLE (
    usuario_id uuid,
    saldo_antes numeric,
    saldo_despues numeric,
    cantidad numeric,
    tipo text,
    mensaje text,
    transaccion_id uuid,
    replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
    v_admin_id uuid := auth.uid();
    v_admin public.perfiles%ROWTYPE;
    v_target public.perfiles%ROWTYPE;
    v_op public.admin_ajustes_saldo_idempotencia%ROWTYPE;
    v_motivo text := COALESCE(NULLIF(pg_catalog.btrim(p_motivo), ''), 'Ajuste por admin');
    v_delta numeric;
    v_saldo_despues numeric;
    v_mensaje text;
    v_transaccion_id uuid;
BEGIN
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    SELECT p.* INTO v_admin
      FROM public.perfiles AS p
     WHERE p.id = v_admin_id;

    IF NOT FOUND OR v_admin.es_admin IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'No autorizado: se requiere administrador';
    END IF;

    IF p_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Usuario destino inválido';
    END IF;
    IF p_tipo IS NULL OR p_tipo NOT IN ('deposito', 'retiro') THEN
        RAISE EXCEPTION 'Tipo de ajuste inválido';
    END IF;
    IF p_cantidad IS NULL OR p_cantidad <= 0 OR p_cantidad <> pg_catalog.trunc(p_cantidad) THEN
        RAISE EXCEPTION 'La cantidad debe ser un entero mayor que cero';
    END IF;
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Se requiere idempotency_key';
    END IF;
    IF pg_catalog.char_length(COALESCE(p_motivo, '')) > 500 THEN
        RAISE EXCEPTION 'Motivo demasiado largo (máximo 500 caracteres)';
    END IF;

    -- Unique-key conflict serializes identical concurrent keys. A retry can only
    -- replay the exact same payload and cannot mutate saldo or duplicate the ledger.
    INSERT INTO public.admin_ajustes_saldo_idempotencia (
        idempotency_key, admin_id, usuario_id, tipo, cantidad, motivo
    )
    VALUES (p_idempotency_key, v_admin_id, p_usuario_id, p_tipo, p_cantidad, v_motivo)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING * INTO v_op;

    IF NOT FOUND THEN
        SELECT o.* INTO v_op
          FROM public.admin_ajustes_saldo_idempotencia AS o
         WHERE o.idempotency_key = p_idempotency_key
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'No se pudo resolver la clave; reintenta con los mismos datos';
        END IF;
        IF v_op.admin_id IS DISTINCT FROM v_admin_id THEN
            RAISE EXCEPTION 'idempotency_key_conflict';
        END IF;
        IF v_op.usuario_id IS DISTINCT FROM p_usuario_id
           OR v_op.tipo IS DISTINCT FROM p_tipo
           OR v_op.cantidad IS DISTINCT FROM p_cantidad
           OR v_op.motivo IS DISTINCT FROM v_motivo THEN
            RAISE EXCEPTION 'idempotency_key_payload_mismatch';
        END IF;
        IF NOT v_op.completada OR v_op.saldo_antes IS NULL
           OR v_op.saldo_despues IS NULL OR v_op.transaccion_id IS NULL THEN
            RAISE EXCEPTION 'El ajuste previo no tiene evidencia completa; requiere revisión';
        END IF;

        RETURN QUERY
        SELECT v_op.usuario_id,
               v_op.saldo_antes,
               v_op.saldo_despues,
               CASE WHEN v_op.tipo = 'deposito' THEN v_op.cantidad ELSE -v_op.cantidad END,
               v_op.tipo,
               v_op.mensaje,
               v_op.transaccion_id,
               true;
        RETURN;
    END IF;

    SELECT p.* INTO v_target
      FROM public.perfiles AS p
     WHERE p.id = p_usuario_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario destino no encontrado';
    END IF;

    v_delta := CASE WHEN p_tipo = 'deposito' THEN p_cantidad ELSE -p_cantidad END;
    v_saldo_despues := v_target.saldo + v_delta;
    IF v_saldo_despues < 0 THEN
        RAISE EXCEPTION 'Saldo insuficiente: el ajuste no puede dejar saldo negativo';
    END IF;

    -- The profile protection trigger accepts this because the caller is an admin.
    -- Any later failure aborts the entire function statement/transaction.
    PERFORM set_config('cuevacoin.trusted_balance_write', '1', true);

    UPDATE public.perfiles AS p
       SET saldo = v_saldo_despues
     WHERE p.id = p_usuario_id
     RETURNING p.saldo INTO v_saldo_despues;

    INSERT INTO public.transacciones (
        usuario_id, admin_id, tipo, cantidad, saldo_antes, saldo_despues, motivo
    )
    VALUES (
        p_usuario_id,
        v_admin_id,
        CASE WHEN p_tipo = 'deposito' THEN 'deposito_admin' ELSE 'retiro_admin' END,
        v_delta,
        v_target.saldo,
        v_saldo_despues,
        v_motivo
    )
    RETURNING id INTO v_transaccion_id;

    v_mensaje := 'El admin ajustó tu saldo: '
        || CASE WHEN v_delta > 0 THEN '+' ELSE '' END
        || '$' || pg_catalog.to_char(pg_catalog.abs(v_delta), 'FM999999990.00')
        || '. Motivo: ' || v_motivo;

    INSERT INTO public.notificaciones (usuario_id, mensaje, leida, tipo_evento)
    VALUES (p_usuario_id, v_mensaje, false, 'ajuste_saldo');

    INSERT INTO public.auditoria (usuario_id, usuario_nombre, accion)
    VALUES (
        v_admin_id,
        COALESCE(NULLIF(pg_catalog.btrim(v_admin.nombre), ''), v_admin.usuario),
        'Ajustó saldo de '
        || COALESCE(NULLIF(pg_catalog.btrim(v_target.nombre), ''), v_target.usuario)
        || ': ' || CASE WHEN v_delta > 0 THEN '+' ELSE '' END
        || '$' || pg_catalog.to_char(pg_catalog.abs(v_delta), 'FM999999990.00')
        || ' (Motivo: ' || v_motivo || ')'
    );

    UPDATE public.admin_ajustes_saldo_idempotencia AS o
       SET saldo_antes = v_target.saldo,
           saldo_despues = v_saldo_despues,
           transaccion_id = v_transaccion_id,
           mensaje = v_mensaje,
           completada = true
     WHERE o.idempotency_key = p_idempotency_key;

    RETURN QUERY
    SELECT p_usuario_id,
           v_target.saldo,
           v_saldo_despues,
           v_delta,
           p_tipo,
           v_mensaje,
           v_transaccion_id,
           false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolver_retiro(
    p_solicitud_id uuid,
    p_accion text
)
RETURNS TABLE (
    resultado text,
    nuevo_saldo numeric,
    usuario_id uuid,
    usuario_nombre text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
    adm boolean;
    an text;
    r record;
    p record;
    sn numeric;
    sa numeric;
BEGIN
    SELECT es_admin, COALESCE(nombre, usuario)
      INTO adm, an
      FROM public.perfiles
     WHERE id = auth.uid();

    IF adm IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo un admin puede resolver solicitudes de retiro';
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
$function$;

COMMIT;
