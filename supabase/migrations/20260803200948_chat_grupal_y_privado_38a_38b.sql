-- Punto 38: chat grupal (38a) y chat privado desbloqueado por
-- transferencia (38b). Ver plan completo en el TXT maestro, punto 38.

-- 1) Distinguir el tipo de conversación. Default 'soporte' para no
--    romper los mensajes existentes (todos son trabajador<->admin).
alter table public.chat
  add column tipo text not null default 'soporte'
  check (tipo in ('soporte', 'grupal', 'privado'));

-- 2) Saber CON QUIÉN fue cada transferencia, sin depender del texto de
--    "motivo". Filas viejas quedan NULL (no se puede reconstruir de forma
--    confiable) — transferencias históricas anteriores a este cambio no
--    desbloquean chat privado retroactivamente, solo las nuevas.
alter table public.transacciones
  add column contraparte_id uuid references public.perfiles(id);

-- 3) Reemplazar la policy de INSERT única (muy permisiva: solo exigía
--    remitente_id=auth.uid(), sin restringir destinatario) por 3 policies
--    específicas, una por tipo de conversación.
drop policy if exists "enviar mensaje" on public.chat;

create policy "chat_soporte_insertar"
on public.chat for insert
to authenticated
with check (
  remitente_id = auth.uid()
  and tipo = 'soporte'
  and destinatario_id is not null
  and (
    es_admin()
    or exists (select 1 from public.perfiles p where p.id = destinatario_id and p.es_admin = true)
  )
);

create policy "chat_grupal_insertar"
on public.chat for insert
to authenticated
with check (
  remitente_id = auth.uid()
  and tipo = 'grupal'
  and destinatario_id is null
);

create policy "chat_privado_insertar"
on public.chat for insert
to authenticated
with check (
  remitente_id = auth.uid()
  and tipo = 'privado'
  and destinatario_id is not null
  and not es_admin()
  and not exists (select 1 from public.perfiles p where p.id = destinatario_id and p.es_admin = true)
  and exists (
    select 1 from public.transacciones t
    where t.usuario_id = auth.uid()
      and t.contraparte_id = destinatario_id
      and t.tipo = 'transferencia'
  )
);

-- 4) Los mensajes grupales los puede VER cualquiera autenticado (no solo
--    remitente/destinatario/admin, que es lo que ya cubre "ver mis chats"
--    para soporte y privado).
create policy "chat_grupal_ver"
on public.chat for select
to authenticated
using (tipo = 'grupal');