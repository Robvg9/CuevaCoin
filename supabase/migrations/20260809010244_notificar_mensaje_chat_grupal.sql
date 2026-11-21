-- Punto 1 (2026-08-09, fix "notificaciones rotas"): el chat Grupal nunca
-- generaba notificaciones reales para nadie fuera de la pestaña abierta.
-- Esta policy autoriza a CUALQUIER usuario autenticado a insertar una
-- notificación de tipo 'mensaje_chat' para OTRO usuario, pero SOLO si
-- puede probar que efectivamente acaba de mandar un mensaje al chat
-- grupal (fila en `chat` con remitente_id = quien llama, tipo='grupal',
-- en los últimos 30 segundos). El chat grupal ya es visible para todos
-- los usuarios de la app, así que esto no expone nada nuevo - solo deja
-- que la notificación/push lleguen aunque el destinatario tenga la app
-- cerrada.
CREATE POLICY "notificar mensaje chat grupal" ON notificaciones
FOR INSERT
WITH CHECK (
  tipo_evento = 'mensaje_chat'
  AND EXISTS (
    SELECT 1 FROM chat c
    WHERE c.remitente_id = auth.uid()
      AND c.tipo = 'grupal'
      AND c.creado_en > now() - interval '30 seconds'
  )
);
