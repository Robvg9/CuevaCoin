-- Bucket público para fotos de perfil (punto 24 del roadmap). Público
-- porque las fotos se muestran en <img> sin pedir autenticación (topbar,
-- tabla de admin, etc). Cada archivo se guarda como "{usuario_id}/foto.jpg"
-- (o la extensión que corresponda), así que la carpeta = usuario_id, que es
-- justo lo que usan las policies para saber de quién es cada archivo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-perfil', 'fotos-perfil', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

-- Cualquiera puede VER las fotos (bucket público, la app las muestra sin
-- login: topbar, tabla de admin, etc).
create policy "fotos_perfil_lectura_publica"
on storage.objects for select
using (bucket_id = 'fotos-perfil');

-- Un usuario autenticado solo puede SUBIR dentro de su propia carpeta
-- (primer segmento del path = su propio auth.uid()).
create policy "fotos_perfil_insertar_propia"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'fotos-perfil'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Un usuario autenticado solo puede REEMPLAZAR/ACTUALIZAR sus propios
-- archivos (para cuando cambia de foto y se sube con el mismo nombre).
create policy "fotos_perfil_actualizar_propia"
on storage.objects for update
to authenticated
using (
  bucket_id = 'fotos-perfil'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'fotos-perfil'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Un usuario autenticado solo puede BORRAR sus propios archivos.
create policy "fotos_perfil_borrar_propia"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'fotos-perfil'
  and (storage.foldername(name))[1] = auth.uid()::text
);