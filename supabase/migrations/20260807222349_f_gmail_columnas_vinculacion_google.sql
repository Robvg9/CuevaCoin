-- F-GMAIL: columnas para el login dual Google + usuario/contraseña.
-- Se usan columnas nuevas y separadas de "correo" (que ya existe para
-- otro fin, ver nota de la sesión 2026-08-07 en el documento maestro).
-- Todo perfil (viejo o nuevo) arranca en false: la vinculación con
-- Google es OBLIGATORIA para poder seguir operando (respuesta del
-- usuario del 2026-08-07), tanto para cuentas ya existentes como para
-- las que se creen de ahora en más con usuario/contraseña.
alter table public.perfiles
    add column if not exists google_vinculado boolean not null default false,
    add column if not exists google_email text;

comment on column public.perfiles.google_vinculado is 'F-GMAIL: true cuando este perfil ya vinculó/verificó una cuenta real de Google (linkIdentity). Obligatorio para operar - ver F-GMAIL en el documento maestro.';
comment on column public.perfiles.google_email is 'F-GMAIL: email de la cuenta de Google vinculada (identity_data.email), separado del email falso usuario@cuevacoin.local usado internamente para el login por usuario/contraseña.';
