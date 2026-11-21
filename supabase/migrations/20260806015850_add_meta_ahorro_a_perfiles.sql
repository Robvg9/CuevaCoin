ALTER TABLE public.perfiles
  ADD COLUMN meta_ahorro numeric NULL;

COMMENT ON COLUMN public.perfiles.meta_ahorro IS 'Monto objetivo de ahorro que la trabajadora se fija (opcional). El progreso se calcula en el frontend comparando perfiles.saldo contra este valor. NULL = sin meta fijada. No requiere cambios de RLS: la policy de UPDATE ya es por fila completa, no por columna.';