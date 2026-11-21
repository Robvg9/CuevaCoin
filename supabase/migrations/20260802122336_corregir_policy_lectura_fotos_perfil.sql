-- El bucket ya es público (public=true), así que las fotos se pueden ver
-- por su URL directa sin necesitar ninguna policy de SELECT — Supabase
-- sirve objetos de buckets públicos por la URL pública sin pasar por RLS.
-- La policy de SELECT que se había agregado permitía además LISTAR todos
-- los archivos del bucket vía API (get_advisors lo marcó como
-- public_bucket_allows_listing), que es más acceso del necesario. Se
-- borra esa policy; el bucket sigue sirviendo las fotos igual por URL.
drop policy if exists "fotos_perfil_lectura_publica" on storage.objects;