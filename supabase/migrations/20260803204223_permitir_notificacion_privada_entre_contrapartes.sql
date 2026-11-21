-- Punto 38b (chat privado): cuando un trabajador le escribe a otro con
-- quien ya se transfirió saldo, sendPrivadoMessage() en el frontend
-- necesita poder insertar una fila en "notificaciones" para avisarle
-- (mismo patrón que ya existe para el chat de soporte trabajador->admin,
-- ver migración permitir_insert_notificaciones_trabajador_a_admin).
-- La tabla notificaciones no guarda quién la generó (no hay remitente_id),
-- así que la condición se valida contra transacciones: solo se permite si
-- quien llama (auth.uid()) ya tiene una transferencia registrada con el
-- destinatario de la notificación (usuario_id), igual que la policy
-- chat_privado_insertar de la tabla chat.
create policy "trabajador notifica a contraparte de transferencia"
on public.notificaciones
for insert
to authenticated
with check (
  exists (
    select 1 from public.transacciones t
    where t.usuario_id = auth.uid()
      and t.contraparte_id = notificaciones.usuario_id
      and t.tipo = 'transferencia'
  )
);
