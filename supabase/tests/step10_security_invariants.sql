-- Run after step10 migration on the intended CuevaCoin database.
-- Read-only assertions; throws on any failed security invariant.
DO $test$
DECLARE v_name text;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
           AND c.relname <> 'admin_ajustes_saldo_idempotencia'
           AND has_table_privilege('anon', c.oid, 'TRUNCATE')
    ) THEN RAISE EXCEPTION 'FAIL: anon retains TRUNCATE on a public table'; END IF;

    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
           AND has_table_privilege('authenticated', c.oid, 'TRUNCATE')
    ) THEN RAISE EXCEPTION 'FAIL: authenticated retains TRUNCATE on a public table'; END IF;

    IF has_table_privilege('anon', 'public.perfiles', 'SELECT')
       OR has_table_privilege('anon', 'public.perfiles', 'UPDATE')
       OR has_table_privilege('anon', 'public.perfiles', 'DELETE') THEN
        RAISE EXCEPTION 'FAIL: anon still has a direct grant on perfiles';
    END IF;

    IF has_column_privilege('anon', 'public.perfiles', 'saldo', 'SELECT')
       OR has_column_privilege('anon', 'public.perfiles', 'correo', 'SELECT')
       OR has_column_privilege('anon', 'public.perfiles', 'numero_carnet', 'SELECT') THEN
        RAISE EXCEPTION 'FAIL: anon can still select a sensitive profile column';
    END IF;

    IF has_function_privilege('anon', 'public.admin_pagar_saldo(uuid[],numeric,text,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.admin_resolver_retiro(uuid,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.solicitar_retiro(numeric,text,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.admin_ajustar_saldo_atomico(uuid,text,numeric,text,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: anon can execute a privileged finance RPC';
    END IF;

    IF NOT has_function_privilege('authenticated', 'public.admin_ajustar_saldo_atomico(uuid,text,numeric,text,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: authenticated is missing the admin adjustment RPC grant';
    END IF;

    PERFORM 'public.admin_ajustar_saldo_atomico(uuid,text,numeric,text,uuid)'::regprocedure;

    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.admin_ajustes_saldo_idempotencia'::regclass) THEN
        RAISE EXCEPTION 'FAIL: idempotency table does not have RLS enabled';
    END IF;

    SELECT proname INTO v_name FROM pg_proc
     WHERE oid = 'public.es_admin()'::regprocedure;
    IF NOT (SELECT proconfig @> ARRAY['search_path=pg_catalog, public'] FROM pg_proc WHERE oid='public.es_admin()'::regprocedure) THEN
        RAISE EXCEPTION 'FAIL: es_admin search_path is not pinned';
    END IF;

    RAISE NOTICE 'PASS: Step 10 security grants, anonymous isolation, RPC grant and RLS verified';
END;
$test$;
