-- CuevaCoin: recuperación administrativa de contraseña con código de un solo uso.
-- El código nunca se almacena en claro; solo se conserva SHA-256 del código aleatorio.
-- El backend Supabase service-role es el único que lee/escribe estas columnas.

BEGIN;

alter table public.password_recovery_requests
  add column if not exists recovery_method text not null default 'email',
  add column if not exists status text not null default 'pending',
  add column if not exists admin_code_hash text,
  add column if not exists admin_code_issued_at timestamptz,
  add column if not exists admin_code_expires_at timestamptz,
  add column if not exists admin_code_attempts integer not null default 0,
  add column if not exists admin_code_used_at timestamptz,
  add column if not exists admin_approved_by uuid references public.perfiles(id),
  add column if not exists admin_verified_at timestamptz,
  add column if not exists admin_verification_channel text;

alter table public.password_recovery_requests
  drop constraint if exists password_recovery_requests_recovery_method_check;
alter table public.password_recovery_requests
  add constraint password_recovery_requests_recovery_method_check
  check (recovery_method in ('email', 'admin'));

alter table public.password_recovery_requests
  drop constraint if exists password_recovery_requests_status_check;
alter table public.password_recovery_requests
  add constraint password_recovery_requests_status_check
  check (status in ('pending', 'issued', 'processing', 'completed', 'expired', 'rejected'));

alter table public.password_recovery_requests
  drop constraint if exists password_recovery_requests_admin_verification_channel_check;
alter table public.password_recovery_requests
  add constraint password_recovery_requests_admin_verification_channel_check
  check (admin_verification_channel is null or admin_verification_channel in ('whatsapp', 'presencial'));

alter table public.password_recovery_requests
  drop constraint if exists password_recovery_requests_admin_code_attempts_check;
alter table public.password_recovery_requests
  add constraint password_recovery_requests_admin_code_attempts_check
  check (admin_code_attempts between 0 and 5);

create index if not exists password_recovery_requests_admin_queue_idx
  on public.password_recovery_requests (created_at desc)
  where recovery_method = 'admin' and status in ('pending', 'issued');

create unique index if not exists password_recovery_requests_one_active_admin_per_profile_idx
  on public.password_recovery_requests (profile_id)
  where recovery_method = 'admin' and status in ('pending', 'issued', 'processing');

comment on column public.password_recovery_requests.recovery_method is
  'email = enlace seguro de correo existente; admin = recuperación asistida por administrador.';
comment on column public.password_recovery_requests.admin_code_hash is
  'SHA-256 de un código aleatorio de alta entropía; el código original solo se entrega una vez al administrador.';
comment on column public.password_recovery_requests.admin_code_expires_at is
  'Caducidad del código administrativo; duración prevista: 15 minutos desde su emisión.';
comment on column public.password_recovery_requests.admin_verified_at is
  'Instante en que el administrador confirmó la identidad antes de emitir el código.';
comment on column public.password_recovery_requests.admin_verification_channel is
  'Canal usado por el administrador para verificar a la titular: whatsapp o presencial.';

COMMIT;
