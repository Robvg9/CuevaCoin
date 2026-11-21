DROP POLICY IF EXISTS "usuario crea su solicitud" ON public.solicitudes_retiro;

CREATE POLICY "usuario crea su solicitud"
ON public.solicitudes_retiro
FOR INSERT
WITH CHECK (usuario_id = auth.uid());