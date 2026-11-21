-- Bug B2 (2026-08-02): la política de INSERT sobre "notificaciones" solo
-- permitía insertar al admin (with_check: es_admin()). Esto bloqueaba que
-- una trabajadora insertara la notificación "te escribió" para el admin al
-- mandarle un mensaje de chat (sendUserMessage() en index.html), aunque el
-- insert en la tabla "chat" sí funcionaba. Se amplía el permiso para que
-- cualquier usuario autenticado pueda insertar una notificación SOLO si el
-- destinatario (usuario_id) es un administrador -- así una trabajadora no
-- puede mandarle notificaciones falsas a otra trabajadora, solo al admin.
drop policy if exists "admin crea notificaciones" on public.notificaciones;

create policy "admin o hacia-admin crea notificaciones"
on public.notificaciones
for insert
with check (
  es_admin()
  or usuario_id in (select id from public.perfiles where es_admin = true)
);