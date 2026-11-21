CREATE OR REPLACE FUNCTION public.proteger_columnas_sensibles_perfil()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  if not (public.es_admin() or auth.role() = 'service_role') then
    new.saldo := old.saldo;
    new.es_admin := old.es_admin;
    new.estado := old.estado;
    new.numero_cuenta := old.numero_cuenta;
    new.usuario := old.usuario;
    -- Punto 31 (2026-08-04): correo_verificado y fecha_limite_verificacion
    -- solo los puede tocar la Edge Function verificar-codigo-correo (via
    -- service_role) o un admin — nunca el cliente directo, aunque tenga
    -- permiso de columna a nivel de GRANT, para que nadie pueda marcarse
    -- verificado sin haber validado el código de verdad.
    new.correo_verificado := old.correo_verificado;
    new.fecha_limite_verificacion := old.fecha_limite_verificacion;
  end if;
  return new;
end;
$$;