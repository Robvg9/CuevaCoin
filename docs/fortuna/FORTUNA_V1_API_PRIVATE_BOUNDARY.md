# FORTUNA v1 — API schema / private helper boundary (test-only)

**Estado:** prototipo de seguridad local; no es una migración, API productiva ni autorización para cambiar Data API settings.  
**Base main:** `f54d55930530bfb1955a9e7e298ead30b1cb1b7f`.

## Candidate topology

- `api`: el único schema de negocio que se consideraría exponer al Data API, después de un Human Gate.
- `fortuna_private`: tablas, libro, eventos, ledger, idempotencia y helpers internos. Nunca se agrega al listado de schemas expuestos del Data API.
- La función expuesta `api.*` es `SECURITY INVOKER` y solo delega en un helper aprobado.
- El helper `fortuna_private.*` es `SECURITY DEFINER`, con `search_path=pg_catalog`, nombres totalmente calificados, sin parámetros de identidad y con `auth.uid()` derivado del JWT que PostgREST valida.
- `authenticated` tiene USAGE/EXECUTE mínimo para llegar al wrapper y helper, pero no SELECT/INSERT/UPDATE/DELETE sobre tablas privadas. `anon` no recibe acceso al schema ni EXECUTE.
- El wrapper API no recibe `owner_user_id`, `actor_user_id` ni `user_id`; no puede suplantar a otra cuenta. El helper valida que exista un subject Auth y busca el libro únicamente por `owner_user_id = auth.uid()`.

## Lo que verifica el prototipo

El fichero `supabase/tests/fortuna_v1_api_boundary_prototype.sql` es un overlay aislado; `scripts/verify-fortuna-api-boundary.mjs` ejecuta un PostgreSQL 17 efímero PGlite. Valida:

1. Grants de schema y función: authenticated puede ejecutar solo el wrapper/helper autorizado; anon no.
2. El wrapper es SECURITY INVOKER, el helper está en schema privado y es SECURITY DEFINER; ambos fijan `search_path`.
3. Ninguna identidad/owner ID es argumento de la función.
4. Cada uno de dos usuarios obtiene únicamente su book ID; el segundo es un administrador global simulado de CuevaCoin y aun así no accede al primer libro.
5. El rol authenticated no puede leer/modificar tablas privadas directamente.
6. Sin subject claim la función rechaza la solicitud.
7. La llamada RPC no crea ni modifica registros.

## Límite / configuración hosted pendiente

- PGlite establece manualmente `request.jwt.claim.sub`; no verifica firmas JWT, expiración, revocación, Auth, PostgREST ni Edge Runtime.
- El test no cambia la configuración hosted. Para producción, habrá que exponer únicamente schema `api` en la configuración Data API, no `fortuna_private`, y verificar grants/EXECUTE de los roles reales.
- Security/Performance advisors deben revisarse sobre el esquema real en un proyecto aislado antes de una migración.
- El wrapper y helper del test usan nombres `test_*`; no se deben copiar a LIVE sin rediseño, migración revisada y Human Gate.

## Integración de usuario futura

Una Edge Function de usuario mantendrá `verify_jwt=true` y un contexto user-scoped (`withSupabase({auth:'user'})` o el patrón oficial equivalente). La RPC `api` puede invocarse con el JWT del usuario; los permisos y la identidad se validan en Postgres con `auth.uid()`. No usar service_role para esta ruta, no aceptar actor IDs en el body y no conceder permisos directos a tablas privadas.

## Alternativa que permanece abierta

Supabase también documenta conexión PostgreSQL directa desde Edge Functions. Antes de elegirla hay que probar un rol SQL dedicado de mínimo privilegio, RLS/claims por transacción, pool mode, prepared statements y almacenamiento de credenciales. No usar `postgres` ni `service_role` como rol compartido.

Referencias:
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/api/using-custom-schemas
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/connect-to-postgres
