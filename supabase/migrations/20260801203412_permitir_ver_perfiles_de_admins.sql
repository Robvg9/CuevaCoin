-- Cualquier usuario autenticado puede ver los perfiles que son de admins
-- (necesario para que el historial del trabajador muestre el nombre del
-- admin responsable de cada transacción, vía join transacciones->perfiles).
-- No expone nada de los trabajadores entre sí: solo filas con es_admin=true.
CREATE POLICY "cualquiera ve perfiles de admins" ON public.perfiles
  FOR SELECT
  USING (es_admin = true);