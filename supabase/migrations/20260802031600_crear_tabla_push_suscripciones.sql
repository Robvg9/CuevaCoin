CREATE TABLE public.push_suscripciones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_suscripciones ENABLE ROW LEVEL SECURITY;

-- Cada usuario ve/crea/borra solo sus propias suscripciones (una por dispositivo/navegador)
CREATE POLICY "usuario_ve_sus_suscripciones" ON public.push_suscripciones
    FOR SELECT USING (usuario_id = auth.uid());

CREATE POLICY "usuario_crea_sus_suscripciones" ON public.push_suscripciones
    FOR INSERT WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "usuario_borra_sus_suscripciones" ON public.push_suscripciones
    FOR DELETE USING (usuario_id = auth.uid());

-- El admin necesita leer TODAS las suscripciones para poder mandarles push
-- (ej. "tu retiro fue aprobado") a cualquier trabajador, no solo a sí mismo.
CREATE POLICY "admin_ve_todas_las_suscripciones" ON public.push_suscripciones
    FOR SELECT USING (public.es_admin());