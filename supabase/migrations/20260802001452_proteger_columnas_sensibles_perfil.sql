
-- Seguridad: aunque la política RLS de UPDATE permite que un trabajador
-- actualice su propia fila en "perfiles" (id = auth.uid()), esa política
-- NO restringe columnas. Sin este trigger, cualquier trabajador con las
-- devtools abiertas podría llamar
-- supabase.from('perfiles').update({saldo: 999999, es_admin: true})
-- y modificar su propio saldo o volverse admin. Este trigger congela las
-- columnas sensibles a su valor anterior si quien actualiza no es admin,
-- dejando pasar libremente los campos de perfil editable (punto 12).

create or replace function public.proteger_columnas_sensibles_perfil()
returns trigger
language plpgsql
security definer
as $$
begin
  if not public.es_admin() then
    new.saldo := old.saldo;
    new.es_admin := old.es_admin;
    new.estado := old.estado;
    new.numero_cuenta := old.numero_cuenta;
    new.usuario := old.usuario;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_columnas_sensibles_perfil on public.perfiles;
create trigger trg_proteger_columnas_sensibles_perfil
before update on public.perfiles
for each row execute function public.proteger_columnas_sensibles_perfil();
