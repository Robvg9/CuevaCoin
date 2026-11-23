BEGIN;

-- FORTUNA V167: safe lookup/link of existing active CuevaCoin profiles.
-- Exposes only public identity labels; sensitive profile attributes are excluded.
CREATE OR REPLACE FUNCTION fortuna_private.fortuna_search_profiles(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_search_profiles$
DECLARE
  v_actor uuid := auth.uid();
  v_query text := pg_catalog.btrim(COALESCE(p_query, ''));
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;
  IF pg_catalog.length(v_query) < 2 OR pg_catalog.length(v_query) > 80 THEN
    RAISE EXCEPTION 'fortuna_profile_query_invalid';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'profile_id', p.id,
      'username', p.usuario,
      'display_name', COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', p.nombre, p.apellido)), ''), p.usuario)
    )
    ORDER BY pg_catalog.lower(p.usuario), p.id
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT id, usuario, nombre, apellido
    FROM public.perfiles
    WHERE estado = 'activo'
      AND id <> v_actor
      AND (
        pg_catalog.strpos(pg_catalog.lower(COALESCE(usuario, '')), pg_catalog.lower(v_query)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(pg_catalog.concat_ws(' ', nombre, apellido)), pg_catalog.lower(v_query)) > 0
      )
    ORDER BY pg_catalog.lower(usuario), id
    LIMIT 20
  ) AS p;

  RETURN v_result;
END;
$fortuna_search_profiles$;

CREATE OR REPLACE FUNCTION fortuna_private.fortuna_link_profile_contact(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_link_profile_contact$
DECLARE
  v_actor uuid := auth.uid();
  v_book_id uuid;
  v_name text;
  v_username text;
  v_contact_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;
  IF p_profile_id IS NULL OR p_profile_id = v_actor THEN
    RAISE EXCEPTION 'fortuna_profile_invalid';
  END IF;

  SELECT COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', p.nombre, p.apellido)), ''), p.usuario),
         p.usuario
    INTO v_name, v_username
    FROM public.perfiles AS p
   WHERE p.id = p_profile_id
     AND p.estado = 'activo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fortuna_profile_not_found';
  END IF;

  v_book_id := fortuna_private.fortuna_ensure_current_book_id();

  INSERT INTO fortuna_private.financial_contacts(book_id, display_name, linked_profile_id)
  VALUES (v_book_id, v_name, p_profile_id)
  ON CONFLICT (book_id, linked_profile_id) WHERE linked_profile_id IS NOT NULL
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_contact_id;

  RETURN pg_catalog.jsonb_build_object(
    'contact_id', v_contact_id,
    'display_name', v_name,
    'username', v_username,
    'linked_profile_id', p_profile_id
  );
END;
$fortuna_link_profile_contact$;

CREATE OR REPLACE FUNCTION api.search_fortuna_profiles(p_query text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_search_profiles$
  SELECT fortuna_private.fortuna_search_profiles($1);
$fortuna_api_search_profiles$;

CREATE OR REPLACE FUNCTION api.link_fortuna_profile_contact(p_profile_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_link_profile_contact$
  SELECT fortuna_private.fortuna_link_profile_contact($1);
$fortuna_api_link_profile_contact$;

REVOKE ALL ON FUNCTION fortuna_private.fortuna_search_profiles(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fortuna_private.fortuna_link_profile_contact(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_search_profiles(text) TO authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_link_profile_contact(uuid) TO authenticated;
REVOKE ALL ON FUNCTION api.search_fortuna_profiles(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION api.link_fortuna_profile_contact(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.search_fortuna_profiles(text) TO authenticated;
GRANT EXECUTE ON FUNCTION api.link_fortuna_profile_contact(uuid) TO authenticated;

COMMIT;
