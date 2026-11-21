ALTER TABLE public.sugerencias
  ADD COLUMN IF NOT EXISTS respuesta text,
  ADD COLUMN IF NOT EXISTS respuesta_en timestamptz,
  ADD COLUMN IF NOT EXISTS respuesta_vista boolean NOT NULL DEFAULT false;
