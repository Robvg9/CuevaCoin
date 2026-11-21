CREATE OR REPLACE FUNCTION public.resolver_destinatario_transferencia(p_identificador text)
RETURNS TABLE(id uuid, usuario text, nombre text, correo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v text := NULLIF(trim(p_identificador), '');
  v_lc text;
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'Identificador requerido';
  END IF;

  v_lc := lower(v);

  RETURN QUERY
  SELECT p.id, p.usuario, p.nombre, p.correo
  FROM public.perfiles p
  WHERE p.estado = 'activo'
    AND p.es_admin = false
    AND (
      lower(trim(p.usuario)) = v_lc
      OR lower(trim(p.correo)) = v_lc
      OR lower(trim(p.nombre)) = v_lc
    )
  ORDER BY CASE
    WHEN lower(trim(p.usuario)) = v_lc THEN 0
    WHEN lower(trim(p.correo)) = v_lc THEN 1
    WHEN lower(trim(p.nombre)) = v_lc THEN 2
    ELSE 3
  END, p.id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe ninguna cuenta con ese usuario, nombre o correo electrónico';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolver_destinatario_transferencia(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolver_destinatario_transferencia(text) TO authenticated;