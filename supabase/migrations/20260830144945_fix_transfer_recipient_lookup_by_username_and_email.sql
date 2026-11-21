BEGIN;

CREATE OR REPLACE FUNCTION public.resolver_destinatario_transferencia(p_identificador text)
RETURNS TABLE(id uuid, usuario text, nombre text, correo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v text := NULLIF(trim(p_identificador), '');
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'Identificador requerido';
  END IF;

  RETURN QUERY
  SELECT p.id, p.usuario, p.nombre, p.correo
  FROM public.perfiles p
  WHERE p.estado = 'activo'
    AND p.es_admin = false
    AND (
      lower(trim(p.usuario)) = lower(v)
      OR lower(trim(p.correo)) = lower(v)
    )
  ORDER BY CASE WHEN lower(trim(p.usuario)) = lower(v) THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe ninguna cuenta con ese usuario o correo electrónico';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolver_destinatario_transferencia(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_destinatario_transferencia(text) TO authenticated;

COMMIT;