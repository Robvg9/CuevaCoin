-- Nota: el auto-registro (botón "Crear cuenta" en login) usa la Edge
-- Function crear-cuenta-propia (service role, sin RLS de por medio), así
-- que no requiere una policy nueva de INSERT en perfiles. Esta migración
-- queda vacía a propósito, documentada acá para que quede el rastro en
-- el historial de migraciones de por qué NO se agregó una policy pública
-- de auto-inserción (hubiera sido redundante e innecesariamente permisiva).
select 1;