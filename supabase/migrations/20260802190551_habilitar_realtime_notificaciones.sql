-- Punto 33 (2026-08-02, pedido del usuario): para que el punto rojo de
-- notificaciones nuevas en la campanita y en el botón de menú (☰) se
-- actualice EN VIVO sin recargar la página, se necesita Realtime en la
-- tabla "notificaciones" (antes solo "chat" estaba habilitada).
alter publication supabase_realtime add table public.notificaciones;