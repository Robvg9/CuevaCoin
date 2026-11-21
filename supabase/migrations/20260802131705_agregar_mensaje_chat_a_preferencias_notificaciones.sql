ALTER TABLE public.perfiles
ALTER COLUMN preferencias_notificaciones SET DEFAULT '{
  "ajuste_saldo": true,
  "retiro_aprobado": true,
  "retiro_rechazado": true,
  "retiro_tiempo_avisado": true,
  "transferencia_recibida": true,
  "mensaje_chat": true
}'::jsonb;

UPDATE public.perfiles
SET preferencias_notificaciones = preferencias_notificaciones || '{"mensaje_chat": true}'::jsonb
WHERE NOT (preferencias_notificaciones ? 'mensaje_chat');