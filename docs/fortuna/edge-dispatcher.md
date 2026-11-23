# FORTUNA Edge Dispatcher — v1 (LIVE)

## Estado actual

<badge>ACTIVE v2</badge>

- Proyecto Supabase: `zqgmjwfvluboiporytcq`.
- Endpoint: `POST https://zqgmjwfvluboiporytcq.supabase.co/functions/v1/fortuna-dispatch`.
- Estado LIVE: `fortuna-dispatch` **ACTIVE v2**, `verify_jwt=true`.
- Fuente: GitHub `main` SHA `cf593244722eca6c85861948e8bbce907b323a1f`; archivo `supabase/functions/fortuna-dispatch/index.ts`, Git blob `941cb115eb697d28cfe376c1e6c92803bec7da50`.
- Digest informado por Supabase para v2: `67082fb9f84f7fc6ac4b328f7cdf02efd56ffe87ff3dc106a33eef9e9085597a`.
- El contenido recuperado con `get_edge_function` coincide byte por byte con el archivo de GitHub en ese SHA.
- Human Gate de despliegue: **APROBADO**. La primera carga v1 se corrigió inmediatamente tras detectar un escape incorrecto en la expresión Bearer; v2 es la versión final comprobada. No se desplegó ni modificó otra función.

## Alcance HTTP

Solo acepta `POST` y `OPTIONS`; los cuerpos están limitados a 32 KiB. El cuerpo POST usa el envelope:

```json
{
  "operation": "list_contacts",
  "args": {}
}
```

No se acepta nombre de RPC, schema, tabla ni SQL arbitrario del cliente. El dispatcher traduce únicamente estas siete operaciones:

- `create_contact`
- `open_obligation`
- `list_contacts`
- `list_obligations`
- `preview_settlement`
- `receive_cash`
- `pay_contact`

La ruta de lectura y escritura se realiza con RPCs de propietario en `api`. Los contratos y argumentos concretos de cada RPC se mantienen en el SQL y sus verificadores de FORTUNA; este dispatcher no implementa CRUD genérico.

## Autenticación y seguridad

- Supabase Edge Gateway exige un JWT válido porque la función se desplegó con `verify_jwt=true`.
- El handler extrae el Bearer y vuelve a validar exactamente ese token con `supabase.auth.getUser(accessToken)`.
- Reenvía el mismo encabezado `Authorization` a PostgREST.
- Utiliza el default de `SUPABASE_PUBLISHABLE_KEYS` cuando está disponible y, como compatibilidad, `SUPABASE_ANON_KEY`. Ninguna de esas claves sustituye el JWT de usuario.
- No usa `service_role`, secreto administrativo, cliente admin ni bypass de RLS.
- El nombre de operación se valida contra una allowlist cerrada de siete operaciones.
- CORS permite el origen de producción `https://cuevacoin.robvg9.workers.dev`; requests nativas sin `Origin` siguen permitidas.
- Si `api` desaparece de Data API Exposed Schemas, responde fail-closed con `FORTUNA_API_SCHEMA_NOT_EXPOSED`; nunca intenta una ruta alternativa más privilegiada.

## Activación LIVE de Data API y grants

- El propietario confirmó en Dashboard que `api` está en Data API Exposed Schemas; conserva `public` y `graphql_public`, y mantiene `fortuna_private` excluido. Esta allowlist es owner-confirmed, no legible independientemente con el conector disponible.
- Se aplicó el grant aprobado `GRANT USAGE ON SCHEMA api, fortuna_private TO authenticated`.
- Verificación de catálogo: `authenticated` tiene schema USAGE en `api` y `fortuna_private`; `anon` no tiene USAGE en ninguno.
- Los siete wrappers `api` siguen `SECURITY INVOKER`; EXECUTE se concede a `authenticated` y se deniega a `anon`.
- Las nueve tablas privadas mantienen denegados SELECT/INSERT/UPDATE/DELETE directos a `authenticated` y `anon`.
- El grant de schema no concedió CRUD sobre las tablas privadas.

## Pruebas y bloqueos restantes

**PASS — despliegue y fuente:** ACTIVE v2, `verify_jwt=true`, fuente exacta del SHA aprobado y contrato estático de siete operaciones/no-service-role.

**CI smoke — primer resultado observado:** `scripts/smoke-fortuna-dispatch-auth.mjs` envió una lectura con la clave pública en `apikey` pero sin JWT de usuario. El endpoint respondió HTTP 401 con `AUTH_REQUIRED`; el log de GitHub y `function_edge_logs` confirman que la petición llegó al handler y fue rechazada antes de `auth.getUser()` o de cualquier RPC. Este comportamiento es el esperado: la guía actual de Supabase [Authorization headers](https://supabase.com/docs/guides/functions/auth-headers), actualizada el 20-11-2026, explica que `verify_jwt` acepta claves publishable/secret en `apikey` por compatibilidad, pero esas claves no autentican a un usuario. Por eso el código debe mantener el control explícito: exigir `Authorization: Bearer <user JWT>` y validar con `auth.getUser()`. La configuración LIVE sigue `verify_jwt=true`. El smoke actualizado prueba además un Bearer inválido y exige HTTP 401. Esto no prueba un JWT válido, E2E owner-A/owner-B ni acceso correcto a PostgREST.

**OPEN — Hosted authenticated E2E:** no se ha afirmado una invocación real con un JWT de usuario ni se han probado en Supabase Auth + Edge + PostgREST las operaciones de dos propietarios. Esta sesión no dispone de sesiones/JWTs de dos cuentas de prueba. Las operaciones `create_contact`, `open_obligation`, `receive_cash` y `pay_contact` escriben registros financieros inmutables; no se deben probar contra el proyecto productivo con datos ficticios ni crear movimientos reales.

**OPEN — entorno de prueba aislado:** hace falta un destino hosted autorizado y de coste cero, con dos identidades de prueba, para verificar gateway JWT, owner-A/owner-B, replay de idempotencia y conflicto 409. No crear un proyecto o branch de pago ni reutilizar BattleCruiser o SimpleLife como banco de pruebas.

**OPEN — CI nativo:** `native-postgres-concurrency` sobre main SHA `cf593244722eca6c85861948e8bbce907b323a1f` quedó QUEUED porque no se asignó un runner self-hosted `Windows / X64 / cuevacoin`. El mismo test sí había pasado sobre el PR head previo; eso no reemplaza el resultado del SHA de main.

**OPEN — UI:** el frontend FORTUNA aún no está cableado. Se conectará después de cerrar el E2E hosted, sin mezclar su despliegue con la validación del backend.

## Secuencia para continuar

1. Resolver el E2E hosted con dos propietarios de prueba y un destino aislado sin coste; no pedir al usuario que comparta tokens por chat.
2. Verificar autenticación válida e inválida, aislamiento del propietario, las operaciones de lectura, idempotencia/replay y el conflicto 409; cualquier escritura se queda dentro del destino aislado.
3. Repetir/cerrar el workflow nativo sobre un runner disponible y obtener SUCCESS en el SHA correspondiente.
4. Solo entonces cablear la interfaz FORTUNA y probar el recorrido completo de usuario.

No hay movimientos financieros, eventos, contactos ni obligaciones de prueba creados en Supabase LIVE. No se cambiaron secrets, grants ni otras Edge Functions.

## Verificación estática

`scripts/verify-fortuna-edge-dispatch.mjs` comprueba el patrón de JWT, Auth validation, forwarding, allowlist RPC, preferencia de publishable key, límite de payload, fail-closed ante pérdida de exposición de `api`, ausencia de service-role y el checkpoint documentado del despliegue LIVE. Esas verificaciones estáticas no sustituyen el Hosted authenticated E2E.
