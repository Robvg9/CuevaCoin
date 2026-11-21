-- Read-only catalog assertions. Does not modify financial data or permissions.
DO $$
DECLARE
  v_def text;
  v_result text;
  v_sig regprocedure;
BEGIN
  v_sig := to_regprocedure('public.resolver_destinatario_transferencia_v2(text)');
  IF v_sig IS NULL THEN RAISE EXCEPTION 'Missing ID-only recipient resolver'; END IF;
  SELECT pg_get_function_result(v_sig), pg_get_functiondef(v_sig) INTO v_result, v_def;
  IF v_result ILIKE '%correo%' THEN RAISE EXCEPTION 'Recipient resolver must not return email'; END IF;
  IF v_def NOT ILIKE '%p.correo%' OR v_def NOT ILIKE '%p.estado = ''activo''%' THEN
    RAISE EXCEPTION 'Recipient lookup must preserve email matching and active-recipient filtering';
  END IF;
  IF v_def NOT ILIKE '%v_name_matches > 1%' OR v_def NOT ILIKE '%Nombre ambiguo%' THEN
    RAISE EXCEPTION 'Ambiguous display names must be rejected rather than selecting an arbitrary recipient';
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role must not execute recipient resolver';
  END IF;
  IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated role must execute recipient resolver';
  END IF;

  v_sig := to_regprocedure('public.admin_resolver_retiro(uuid,boolean)');
  IF v_sig IS NULL THEN RAISE EXCEPTION 'Missing boolean withdrawal resolver'; END IF;
  SELECT pg_get_functiondef(v_sig) INTO v_def;
  IF v_def NOT ILIKE '%admin_estado IS DISTINCT FROM ''activo''%' THEN
    RAISE EXCEPTION 'Boolean withdrawal resolver must require active administrator';
  END IF;

  v_sig := to_regprocedure('public.admin_resolver_retiro(uuid,text)');
  IF v_sig IS NULL THEN RAISE EXCEPTION 'Missing text withdrawal resolver'; END IF;
  SELECT pg_get_functiondef(v_sig) INTO v_def;
  IF v_def NOT ILIKE '%admin_estado IS DISTINCT FROM ''activo''%' THEN
    RAISE EXCEPTION 'Text withdrawal resolver must require active administrator';
  END IF;
END;
$$;
