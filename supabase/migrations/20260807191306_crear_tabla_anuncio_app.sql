-- Punto 1 (pendiente v77, sesión 2026-08-07): cartel grande de anuncios
-- al iniciar sesión, editable por el admin desde Bonos, con vigencia en
-- días. Fila única (id=1) que se actualiza siempre con UPDATE, nunca se
-- inserta una fila nueva - más simple que una tabla de histórico para
-- este alcance (un solo anuncio activo a la vez).
create table public.anuncio_app (
  id smallint primary key default 1,
  mensaje text,
  dias_vigencia integer not null default 3,
  creado_en timestamptz not null default now(),
  constraint anuncio_app_fila_unica check (id = 1)
);

comment on table public.anuncio_app is 'Fila única (id=1) con el anuncio grande que se muestra al iniciar sesión, editable por el admin desde Bonos. mensaje null o vacío = sin anuncio activo. Vigente mientras now() <= creado_en + dias_vigencia días.';

insert into public.anuncio_app (id, mensaje, dias_vigencia, creado_en) values (1, null, 3, now());

alter table public.anuncio_app enable row level security;

-- Cualquier usuario logueado (admin o trabajador) puede leer el anuncio
-- activo para mostrarlo al iniciar sesión.
create policy "logueados ven el anuncio" on public.anuncio_app
  for select
  using (auth.uid() is not null);

-- Solo el admin puede editarlo (mismo patrón es_admin() que auditoria).
create policy "admin edita el anuncio" on public.anuncio_app
  for update
  using (es_admin())
  with check (es_admin());
