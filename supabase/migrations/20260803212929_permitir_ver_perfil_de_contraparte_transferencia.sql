CREATE POLICY "ver perfiles de contrapartes de transferencia"
ON public.perfiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.transacciones t
    WHERE t.usuario_id = auth.uid()
      AND t.contraparte_id = perfiles.id
      AND t.tipo = 'transferencia'
  )
);