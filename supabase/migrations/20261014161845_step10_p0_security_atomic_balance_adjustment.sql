-- CuevaCoin Step 10 — P0 grants hardening + atomic admin balance adjustment.
-- Target project: zqgmjwfvluboiporytcq (CuevaCoin). Never run against ARIA.
-- This migration changes permissions and installs an RPC. It does not move funds.
BEGIN;

-- 1) Close anonymous direct access to business tables. Public/anon had table-level
-- SELECT and DML grants, so RLS alone did not prevent reading admin profile rows.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;

-- TRUNCATE bypasses RLS. Remove it (and DDL-like table privileges) from client roles.
REVOKE TRUNCATE, REFERENCES, TRIGGER
ON ALL TABLES IN SCHEMA public
FROM PUBLIC, anon, authenticated;

-- 2) Fail closed for new objects created by either schema-owner role. New tables
-- and RPC functions require deliberate, object-specific grants in future migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
-- 3) Pin search_path on existing privileged functions. All object references in
-- SECURITY DEFINER bodies must resolve against trusted schemas only.
ALTER FUNCTION public.admin_pagar_saldo(uuid[], numeric, text, text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.admin_resolver_retiro(uuid, text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.admin_resolver_retiro(uuid, boolean)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.avisar_meta_ahorro_alcanzada()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.es_admin()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.proteger_columnas_sensibles_perfil()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.resolver_destinatario_transferencia(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.solicitar_retiro(numeric, text, text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.transferir_saldo_atomica(uuid, numeric, text, text)
  SET search_path = pg_catalog, public;

-- 4) Keep privileged entry points off PUBLIC/anon. Authenticated functions remain
-- callable only where the body itself verifies auth.uid()/admin status.
REVOKE EXECUTE ON FUNCTION public.admin_pagar_saldo(uuid[], numeric, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pagar_saldo(uuid[], numeric, text, text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_resolver_retiro(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolver_retiro(uuid, text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_resolver_retiro(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolver_retiro(uuid, boolean)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.avisar_meta_ahorro_alcanzada()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avisar_meta_ahorro_alcanzada()
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.es_admin()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_admin()
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.resolver_destinatario_transferencia(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_destinatario_transferencia(text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.solicitar_retiro(numeric, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_retiro(numeric, text, text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.transferir_saldo_atomica(uuid, numeric, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transferir_saldo_atomica(uuid, numeric, text, text)
  TO authenticated, service_role;

-- 5) Server-side idempotency. No client role receives table access.
CREATE TABLE public.admin_ajustes_saldo_idempotencia (
    idempotency_key uuid PRIMARY KEY,
    admin_id uuid NOT NULL REFERENCES public.perfiles(id),
    usuario_id uuid NOT NULL REFERENCES public.perfiles(id),
    tipo text NOT NULL CHECK (tipo IN ('deposito', 'retiro')),
    cantidad numeric NOT NULL CHECK (cantidad > 0),
    motivo text NOT NULL,
    saldo_antes numeric,
    saldo_despues numeric,
    transaccion_id uuid REFERENCES public.transacciones(id),
    mensaje text,
    completada boolean NOT NULL DEFAULT false,
    creado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_ajustes_saldo_idempotencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_ajustes_saldo_idempotencia
  FROM PUBLIC, anon, authenticated, service_role;

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

REVOKE EXECUTE ON FUNCTION
    public.admin_ajustar_saldo_atomico(uuid, text, numeric, text, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
    public.admin_ajustar_saldo_atomico(uuid, text, numeric, text, uuid)
TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_ajustar_saldo_atomico(uuid, text, numeric, text, uuid)
IS 'Admin-only atomic balance adjustment. Stores balance, ledger, notification, audit and idempotency evidence in one transaction.';

COMMIT;
