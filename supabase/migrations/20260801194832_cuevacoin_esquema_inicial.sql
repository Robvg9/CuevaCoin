-- ============================================================
-- CUEVACOIN — ESQUEMA SUPABASE
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  usuario text unique not null,
  es_admin boolean not null default false,
  saldo numeric(12,2) not null default 0,
  numero_cuenta text unique not null default lpad(floor(random()*1000000000)::text,9,'0'),
  foto_url text,
  estado text not null default 'activo',
  ultima_conexion timestamptz,
  creado_en timestamptz not null default now()
);

create table if not exists public.transacciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  admin_id uuid references public.perfiles(id),
  tipo text not null,
  cantidad numeric(12,2) not null,
  saldo_antes numeric(12,2) not null,
  saldo_despues numeric(12,2) not null,
  motivo text,
  creado_en timestamptz not null default now()
);

create table if not exists public.solicitudes_retiro (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  cantidad numeric(12,2) not null,
  motivo text,
  estado text not null default 'pendiente',
  resuelto_por uuid references public.perfiles(id),
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz
);

create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  mensaje text not null,
  leida boolean not null default false,
  creado_en timestamptz not null default now()
);

create table if not exists public.auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.perfiles(id),
  usuario_nombre text,
  accion text not null,
  ip text,
  dispositivo text,
  creado_en timestamptz not null default now()
);

create table if not exists public.chat (
  id uuid primary key default gen_random_uuid(),
  remitente_id uuid not null references public.perfiles(id) on delete cascade,
  destinatario_id uuid not null references public.perfiles(id) on delete cascade,
  mensaje text not null,
  creado_en timestamptz not null default now()
);

alter table public.perfiles enable row level security;
alter table public.transacciones enable row level security;
alter table public.solicitudes_retiro enable row level security;
alter table public.notificaciones enable row level security;
alter table public.auditoria enable row level security;
alter table public.chat enable row level security;

create or replace function public.es_admin()
returns boolean language sql security definer stable as $$
  select coalesce((select es_admin from public.perfiles where id = auth.uid()), false);
$$;

create policy "ver propio perfil" on public.perfiles for select
  using (id = auth.uid() or public.es_admin());
create policy "admin actualiza cualquier perfil" on public.perfiles for update
  using (public.es_admin() or id = auth.uid());
create policy "admin crea perfiles" on public.perfiles for insert
  with check (public.es_admin());

create policy "ver propias transacciones" on public.transacciones for select
  using (usuario_id = auth.uid() or public.es_admin());
create policy "admin crea transacciones" on public.transacciones for insert
  with check (public.es_admin());

create policy "ver propias solicitudes" on public.solicitudes_retiro for select
  using (usuario_id = auth.uid() or public.es_admin());
create policy "usuario crea su solicitud" on public.solicitudes_retiro for insert
  with check (usuario_id = auth.uid());
create policy "admin resuelve solicitudes" on public.solicitudes_retiro for update
  using (public.es_admin());

create policy "ver propias notificaciones" on public.notificaciones for select
  using (usuario_id = auth.uid() or public.es_admin());
create policy "admin crea notificaciones" on public.notificaciones for insert
  with check (public.es_admin());
create policy "usuario marca leida" on public.notificaciones for update
  using (usuario_id = auth.uid());

create policy "admin ve auditoria" on public.auditoria for select
  using (public.es_admin());
create policy "insertar propia auditoria" on public.auditoria for insert
  with check (usuario_id = auth.uid());

create policy "ver mis chats" on public.chat for select
  using (remitente_id = auth.uid() or destinatario_id = auth.uid() or public.es_admin());
create policy "enviar mensaje" on public.chat for insert
  with check (remitente_id = auth.uid());
