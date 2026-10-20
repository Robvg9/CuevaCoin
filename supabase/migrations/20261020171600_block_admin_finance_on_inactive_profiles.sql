-- CuevaCoin — archive access follow-up.
-- Prevent admin financial RPCs from crediting/adjusting accounts that are not active.
-- This migration changes function definitions only; it performs no balance or ledger writes.
-- Target: zqgmjwfvluboiporytcq (CuevaCoin), never ARIA.

BEGIN;

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

    -- Archived and inactive profiles must not receive financial adjustments,
    -- even if a stale client calls this RPC directly.
    IF v_target.estado IS DISTINCT FROM 'activo' THEN
        RAISE EXCEPTION 'Cuenta destino no activa';
    END IF;

    v_delta := CASE WHEN p_tipo = 'deposito' THEN p_cantidad ELSE -p_cantidad END;
    v_saldo_despues := v_target.saldo + v_delta;
    IF v_saldo_despues < 0 THEN
        RAISE EXCEPTION 'Saldo insuficiente: el ajuste no puede dejar saldo negativo';
    END IF;

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

CREATE OR REPLACE FUNCTION public.admin_pagar_saldo(
    p_destinatarios uuid[],
    p_monto numeric,
    p_motivo text,
    p_tipo text
)
RETURNS TABLE (
    usuario_id uuid,
    nombre text,
    nuevo_saldo numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
    v_soy_admin boolean;
    v_saldo_actual numeric;
    v_estado text;
    v_id uuid;
    v_motivo_final text;
    v_mensaje_notif text;
BEGIN
    SELECT es_admin INTO v_soy_admin
      FROM public.perfiles
     WHERE id = auth.uid();

    IF v_soy_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo un admin puede pagar saldo';
    END IF;
    IF p_monto IS NULL OR p_monto <= 0 THEN
        RAISE EXCEPTION 'Monto inválido';
    END IF;
    IF p_tipo NOT IN ('salario', 'bono') THEN
        RAISE EXCEPTION 'Tipo inválido';
    END IF;

    v_motivo_final := CASE WHEN p_tipo = 'bono'
        THEN 'Bono: ' || COALESCE(p_motivo, '')
        ELSE COALESCE(p_motivo, '')
    END;

    FOREACH v_id IN ARRAY p_destinatarios LOOP
        SELECT saldo, estado
          INTO v_saldo_actual, v_estado
          FROM public.perfiles
         WHERE id = v_id
           AND es_admin = false
         FOR UPDATE;

        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        -- Fail the whole batch before crediting any inactive/archived recipient.
        -- PostgreSQL rolls back earlier loop writes if this exception is raised.
        IF v_estado IS DISTINCT FROM 'activo' THEN
            RAISE EXCEPTION 'No se puede pagar a una cuenta no activa: %', v_id;
        END IF;

        PERFORM set_config('cuevacoin.trusted_balance_write', '1', true);

        UPDATE public.perfiles
           SET saldo = saldo + p_monto
         WHERE id = v_id;

        INSERT INTO public.transacciones (
            usuario_id, admin_id, tipo, cantidad, saldo_antes, saldo_despues, motivo
        )
        VALUES (
            v_id, auth.uid(), 'deposito_admin', p_monto,
            v_saldo_actual, v_saldo_actual + p_monto, v_motivo_final
        );

        v_mensaje_notif := 'Admin te ha enviado $'
            || pg_catalog.trim(pg_catalog.to_char(p_monto, 'FM999999990.00'))
            || CASE WHEN p_tipo = 'bono' THEN ' de bono' ELSE ' de salario' END
            || CASE WHEN p_motivo IS NOT NULL AND p_motivo <> ''
                THEN ' - Motivo: ' || p_motivo ELSE '' END;

        INSERT INTO public.notificaciones (usuario_id, mensaje, leida, tipo_evento)
        VALUES (v_id, v_mensaje_notif, false, 'pago_admin');

        RETURN QUERY
        SELECT p.id, p.nombre, p.saldo
          FROM public.perfiles AS p
         WHERE p.id = v_id;
    END LOOP;
END;
$function$;

COMMIT;
