# MISIÓN FORTUNA — Owner-only, RLS y frontera de Auth

**Estado:** test-only security gate. No es una migración ni autorización de despliegue.  
**Base:** main SHA `dab0f374e5f26c0478e506e6180668936394ed3d`.  
**Regla de producto:** owner-only v1. Una libreta por usuario; la administración global de CuevaCoin no concede acceso a libros personales ajenos.

## 1. Qué valida este gate

El nuevo harness carga el esquema FORTUNA test-only y aplica un overlay de políticas RLS en PGlite/PostgreSQL 17:

- Antes del overlay: `anon` y `authenticated` no tienen `USAGE` en `fortuna_private` ni privilegios directos de tabla.
- La identidad de prueba es leída por `auth.uid()` desde los claims de request que Supabase/PostgREST normalmente inyecta.
- `financial_books` solo es visible para `owner_user_id = auth.uid()`.
- Las tablas hijas se filtran con una función booleana interna `fortuna_private.test_is_book_owner(book_id)`. La función no recibe un owner ID del cliente, tiene `search_path=pg_catalog`, reside fuera del esquema expuesto y su EXECUTE se revoca a PUBLIC/anon.
- INSERT y UPDATE incluyen `WITH CHECK`; evita insertar datos en libros ajenos o transferir la propiedad de una fila.
- Dos usuarios ven únicamente su propia libreta y sus filas asociadas. El segundo usuario está marcado como administrador global en un fixture de CuevaCoin, pero esa condición no se consulta en ninguna política FORTUNA.
- La restricción UNIQUE del esquema mantiene una sola libreta por propietario.
- `anon` no entra al esquema privado; `service_role` bypasses RLS y por ello queda limitado exclusivamente al backend.

## 2. Límite deliberado de la prueba

El harness establece manualmente `request.jwt.claim.sub` para simular el contexto que instala PostgREST. **No valida firmas JWT, expiración, revocación de sesiones, Supabase Auth, Data API ni Edge Runtime.** Tampoco convierte el overlay SQL en migración productiva.

El overlay concede `USAGE` temporal a `authenticated` solo en la base efímera para poder ejecutar y comprobar las políticas RLS. No copiar esos GRANTs a LIVE por inercia. La configuración final debe mantener `fortuna_private` fuera de los esquemas expuestos de Data API y sin grants directos a `anon`/`authenticated`, salvo que una arquitectura aprobada exija otra cosa.

## 3. Diseño obligatorio del endpoint real

- Edge Function de usuario con `verify_jwt=true`; mantener el chequeo de plataforma activo.
- Usar un contexto de usuario verificado (`withSupabase({ auth: 'user' })` de `@supabase/server` o un patrón oficial equivalente).
- Derivar el actor exclusivamente del usuario verificado en el handler. Nunca aceptar `owner_user_id`, `actor_user_id` o `user_id` como autoridad desde el body.
- No usar `user_metadata` para autorización.
- Preferir `ctx.supabase` para las operaciones cubiertas por RLS. Si se necesita `ctx.supabaseAdmin`, recordar que omite RLS y exigir un filtro explícito por el ID verificado en cada operación.
- No confiar en el rol de administrador global de CuevaCoin; la única identidad válida es el usuario Auth dueño del libro.
- Nunca exponer una clave `secret`/service role en navegador, Android, PWA o archivos estáticos.

## 4. Coste y límites del entorno de prueba

Supabase Free concede dos proyectos gratuitos en total entre las organizaciones donde la cuenta es Owner/Administrator; no es un cupo independiente por organización. No pausar ni reutilizar CuevaCoin, BattleCruiser o SimpleLife para pruebas FORTUNA, y no crear proyecto, branch pagado ni recurso con coste para esta fase. El test actual corre solo en PGlite sin servicios alojados.

## 5. Lo que sigue pendiente después de este PR

1. Auth real: token válido, inválido, expirado y usuario eliminado/revocado, usando un proyecto aislado autorizado y sin datos LIVE.
2. Edge Runtime: llamada autenticada real, respuesta 401 sin JWT, y comprobar que el actor se deriva del usuario validado.
3. Data API: confirmar `fortuna_private` no está en schemas expuestos; probar grants, EXECUTE y que el cliente no puede consultar ni mutar tablas directamente.
4. Prueba cruzada con dos usuarios de prueba, incluido un perfil administrador global, sin conceder acceso a datos ajenos.
5. Revisar advisors de Security/Performance en el entorno aislado antes de preparar cualquier migración.

## 6. Documentación vigente revisada

- Supabase actualiza el comportamiento de RLS: las políticas deben nombrar `TO authenticated`, usar `auth.uid()`, y en UPDATE combinar `USING` y `WITH CHECK`. Un filtro `USING` que oculta una fila puede devolver cero filas sin error; la prueba debe comprobar el estado posterior.
- En Edge Functions de usuarios, Supabase documenta mantener `verify_jwt=true` y usar un contexto scoped al usuario. `supabaseAdmin` omite RLS y exige filtros explícitos por identidad verificada.
- Supabase está retirando las claves legacy `anon`/`service_role` al final de 2026; la implementación futura debe preferir publishable y secret keys.
- CLI v3 es local-by-default y pide confirmación antes de cambiar proyectos hosted. No se usó CLI ni se hicieron cambios hosted.

Referencias:
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- https://supabase.com/changelog.md
