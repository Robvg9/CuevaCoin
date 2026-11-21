ALTER TABLE public.perfiles
ADD COLUMN IF NOT EXISTS preferencias_notificaciones jsonb NOT NULL DEFAULT '{
  "ajuste_saldo": true,
  "retiro_aprobado": true,
  "retiro_rechazado": true,
  "retiro_tiempo_avisado": true,
  "transferencia_recibida": true
}'::jsonb;