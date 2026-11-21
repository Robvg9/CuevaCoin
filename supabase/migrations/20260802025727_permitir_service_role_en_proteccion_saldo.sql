CREATE OR REPLACE FUNCTION public.proteger_columnas_sensibles_perfil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if not (public.es_admin() or auth.role() = 'service_role') then
    new.saldo := old.saldo;
    new.es_admin := old.es_admin;
    new.estado := old.estado;
    new.numero_cuenta := old.numero_cuenta;
    new.usuario := old.usuario;
  end if;
  return new;
end;
$function$;