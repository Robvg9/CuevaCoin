-- E12: cualquiera que puede ver el chat grupal (política chat_grupal_ver,
-- ya abierta a todos) también debe poder ver el nombre/usuario de quien
-- escribió, aunque nunca se hayan transferido plata entre ellos. Antes
-- solo existía "ver perfiles de contrapartes de transferencia", que no
-- cubre este caso - por eso salía "N/A" en vez del nombre real.
CREATE POLICY "ver perfiles de remitentes de chat grupal"
ON public.perfiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.chat c
    WHERE c.remitente_id = perfiles.id
    AND c.tipo = 'grupal'
  )
);
