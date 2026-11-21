create table public.favoritos (
    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references public.perfiles(id) on delete cascade,
    favorito_id uuid not null references public.perfiles(id) on delete cascade,
    creado_en timestamptz not null default now(),
    unique (usuario_id, favorito_id)
);

comment on table public.favoritos is 'F1: contactos marcados como favoritos por cada trabajadora, para acceso rápido al transferir (solo puede marcar a personas con las que ya tuvo transferencias, por la misma RLS de perfiles).';

alter table public.favoritos enable row level security;

create policy "ver mis favoritos" on public.favoritos
    for select using (usuario_id = auth.uid());

create policy "insertar mis favoritos" on public.favoritos
    for insert with check (usuario_id = auth.uid());

create policy "borrar mis favoritos" on public.favoritos
    for delete using (usuario_id = auth.uid());
