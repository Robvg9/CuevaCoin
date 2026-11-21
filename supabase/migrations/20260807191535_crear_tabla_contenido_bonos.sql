-- Punto 2 (pendiente v80, sesión 2026-08-07): sección informativa de
-- "próximos bonos / formas de ganar dinero" en Bonos, hoy una lista fija
-- en el HTML ("Esto es lo que te prometemos..."), pasa a ser editable por
-- el admin. Mismo criterio de fila única que anuncio_app (punto 1).
create table public.contenido_bonos (
  id smallint primary key default 1,
  texto text not null,
  actualizado_en timestamptz not null default now(),
  constraint contenido_bonos_fila_unica check (id = 1)
);

comment on table public.contenido_bonos is 'Fila única (id=1) con el texto informativo de "próximos bonos / formas de ganar dinero" que ve el trabajador en Bonos, editable por el admin. actualizado_en se usa del lado del cliente (localStorage) para saber si mostrar la burbuja de aviso de contenido nuevo.';

insert into public.contenido_bonos (id, texto, actualizado_en) values (
  1,
  E'🤖 IA de soporte automática que te ayude al instante, más adelante.\n🎁 Sistema de bonos real, no solo esta página.\n💰 Formas claras de ganar más dinero en La Cueva.',
  now()
);

alter table public.contenido_bonos enable row level security;

create policy "logueados ven el contenido de bonos" on public.contenido_bonos
  for select
  using (auth.uid() is not null);

create policy "admin edita el contenido de bonos" on public.contenido_bonos
  for update
  using (es_admin())
  with check (es_admin());
