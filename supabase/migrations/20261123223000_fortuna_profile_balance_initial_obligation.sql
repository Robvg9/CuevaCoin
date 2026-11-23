-- FORTUNA V168: expose the linked CuevaCoin balance only as part of the
-- authenticated owner-scoped link action. The value is a suggestion for a
-- private CUP obligation; it never mutates CuevaCoin balance or transactions.
BEGIN;

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
  v_balance numeric;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fortuna_auth_required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.perfiles AS owner_profile
    WHERE owner_profile.id = v_actor
      AND owner_profile.es_admin IS TRUE
      AND owner_profile.estado = 'activo'
  ) THEN
    RAISE EXCEPTION 'fortuna_owner_required' USING ERRCODE = '42501';
  END IF;
  IF p_profile_id IS NULL OR p_profile_id = v_actor THEN
    RAISE EXCEPTION 'fortuna_profile_invalid';
  END IF;

  SELECT
    COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', p.nombre, p.apellido)), ''), p.usuario),
    p.usuario,
    COALESCE(p.saldo, 0)
  INTO v_name, v_username, v_balance
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
    'linked_profile_id', p_profile_id,
    'balance_minor', CASE WHEN v_balance > 0 THEN pg_catalog.round(v_balance * 100)::bigint::text ELSE '0' END
  );
END;
$fortuna_link_profile_contact$;

REVOKE ALL ON FUNCTION fortuna_private.fortuna_link_profile_contact(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_link_profile_contact(uuid) TO authenticated;

COMMIT;
