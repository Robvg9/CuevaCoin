-- E2/E11 (2026-08-06): el trabajador necesita poder marcar sus propias
-- sugerencias como "respuesta_vista = true" al abrir la sección Bonos
-- (mismo patrón que marcarNovedadVista en localStorage, pero acá vive en
-- la fila porque el dato tiene que sincronizar entre dispositivos).
-- Antes solo existía sugerencias_update_admin (solo el admin podía
-- hacer UPDATE). Se agrega una policy para que el trabajador pueda
-- actualizar SOLO sus propias filas.
-- DEUDA TÉCNICA: esta policy es a nivel de FILA, no de columna - un
-- trabajador que abra el inspector de red técnicamente podría también
-- reescribir su propio "mensaje" o "leida" via UPDATE directo, no solo
-- "respuesta_vista". Mismo nivel de confianza que el resto de RLS del
-- proyecto (revisado y aceptado como legítimo en sesiones anteriores,
-- ver LECCIONES APRENDIDAS / DEUDA TÉCNICA del documento maestro).
CREATE POLICY sugerencias_update_propia ON sugerencias
FOR UPDATE
USING (auth.uid() = usuario_id);
