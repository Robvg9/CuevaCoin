-- Punto 31: verificación de correo obligatoria (una sola vez), plazo de
-- 7 días, bloquea Transferir/Retirar si no se verifica a tiempo.
ALTER TABLE public.perfiles
  ADD COLUMN correo_verificado boolean NOT NULL DEFAULT false,
  ADD COLUMN fecha_limite_verificacion timestamptz NOT NULL DEFAULT (now() + interval '7 days');

-- RLS es a nivel de fila, no de columna: sin esto, cualquier trabajador
-- podría marcarse "verificado" el mismo desde la consola del navegador
-- (la policy de UPDATE en perfiles ya permite id = auth.uid()). Con este
-- REVOKE, solo el service_role (nuestras Edge Functions) puede tocar esta
-- columna puntual, sin afectar el resto del perfil que sí siguen editando
-- ellas mismas con normalidad.
REVOKE UPDATE (correo_verificado) ON public.perfiles FROM authenticated;

-- Control del límite de 2 correos/hora, compartido por TODO el proyecto
-- (no por usuario) — para poder calcular cuánto falta para el próximo
-- cupo disponible y avisarlo en vez de un error genérico.
CREATE TABLE public.verificacion_correo_envios (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.perfiles(id),
  enviado_en timestamptz not null default now()
);
ALTER TABLE public.verificacion_correo_envios ENABLE ROW LEVEL SECURITY;
-- Sin policies a propósito: nadie desde el cliente puede leer/escribir
-- esta tabla directo, solo las Edge Functions con service_role.

-- Gate a nivel de base de datos para las solicitudes de retiro, que se
-- insertan directo desde el cliente (sin Edge Function de por medio) —
-- si no se refuerza acá, el bloqueo del frontend se podría saltar.
DROP POLICY "usuario crea su solicitud" ON public.solicitudes_retiro;
CREATE POLICY "usuario crea su solicitud" ON public.solicitudes_retiro
  FOR INSERT
  WITH CHECK (
    usuario_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.perfiles p
      WHERE p.id = auth.uid()
        AND (p.correo_verificado = true OR now() < p.fecha_limite_verificacion)
    )
  );