ALTER TABLE public.perfiles
ADD COLUMN IF NOT EXISTS preferencias_privacidad jsonb NOT NULL DEFAULT '{"apellido": true, "numero_carnet": true, "fecha_nacimiento": true, "telefono": true, "correo": true, "ultima_conexion": true}'::jsonb;
