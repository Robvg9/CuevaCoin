-- Punto 49 (aclarado 2026-08-06): evitar que un trabajador cambie su
-- correo con facilidad para hacer algo malo (ej. esquivar a quién le
-- llegan avisos, suplantar identidad al recuperar acceso). Una vez que
-- el perfil ya tiene un correo cargado, cambiarlo NO se guarda directo:
-- queda pendiente hasta que el admin lo apruebe.
create table if not exists public.solicitudes_cambio_correo (
    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references public.perfiles(id) on delete cascade,
    correo_actual text,
    correo_nuevo text not null,
    motivo text,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
    resuelto_por uuid references public.perfiles(id),
    creado_en timestamptz not null default now(),
    resuelto_en timestamptz
);

alter table public.solicitudes_cambio_correo enable row level security;

-- El trabajador puede crear su propia solicitud
create policy "trabajador crea su solicitud de cambio de correo"
on public.solicitudes_cambio_correo
for insert
to authenticated
with check (usuario_id = auth.uid());

-- El trabajador ve sus propias solicitudes, el admin ve todas
create policy "ver solicitudes de cambio de correo"
on public.solicitudes_cambio_correo
for select
to authenticated
using (usuario_id = auth.uid() or es_admin());

-- Solo el admin puede aprobar/rechazar (actualizar estado)
create policy "admin resuelve solicitud de cambio de correo"
on public.solicitudes_cambio_correo
for update
to authenticated
using (es_admin())
with check (es_admin());

alter publication supabase_realtime add table public.solicitudes_cambio_correo;
