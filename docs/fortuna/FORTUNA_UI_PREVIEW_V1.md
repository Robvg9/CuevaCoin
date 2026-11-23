# FORTUNA v1 — Fase 4, pasos 4–5: libro persistente y liquidaciones

**Estado:** Paso 4 y Paso 5 implementados en PR #66 (OPEN/DRAFT). Verificación CI pendiente para el nuevo SHA.
**PWA:** V164.
**Producción:** no fusionado ni desplegado desde esta rama. No se ejecutaron movimientos financieros reales.

## Paso 4 — contactos y obligaciones persistentes

- FORTUNA es una sección compartida para sesiones autenticadas. Cada libro pertenece a la identidad autenticada; el rol de administrador no concede acceso al libro de otra persona.
- Resumen por moneda, ficha por contacto, búsqueda y filtro por CUP/USD/EUR.
- Alta de contacto y apertura de obligación mediante operaciones allowlisted del Edge dispatcher.
- El resumen y las obligaciones abiertas se leen desde el servidor. «Obligaciones» no se presenta como historial completo de eventos.
- Importes enteros en unidades menores (BigInt); «Te debe» y «Le debes» permanecen separados, sin neteo ni conversión automática.
- Claves idempotentes criptográficas; el formulario conserva exactamente payload y clave durante un reintento de respuesta incierta.
- Los formularios y datos transitorios se limpian al cambiar de cuenta o cerrar sesión.

## Paso 5 — vista previa y confirmación de liquidaciones

- En la ficha de cada contacto aparece el panel «Registrar liquidación».
- El propietario selecciona si recibió dinero o pagó dinero, la moneda, el importe y el método FIFO o manual.
- FIFO y manual se calculan exclusivamente en el servidor. La respuesta incluye obligaciones elegibles, asignaciones por obligación, importes asignados, exceso y dirección del exceso.
- El cliente valida el esquema y la reconciliación de la respuesta con BigInt; no calcula ni modifica el ledger ni crea el fingerprint.
- La vista previa queda invalidada cuando cambia cualquier parámetro relevante o se recargan las obligaciones. La confirmación permanece deshabilitada hasta obtener una nueva vista previa.
- La acción de confirmar es independiente de la acción de previsualizar.
- Si hay exceso, la interfaz informa la obligación opuesta que se creará y exige una casilla de confirmación explícita antes de enviar.
- La confirmación envía el fingerprint SHA-256 generado por el servidor. El servidor vuelve a calcular el plan bajo bloqueo; si las obligaciones cambiaron, rechaza la operación como STALE_PREVIEW (HTTP 409). La UI descarta el plan y obliga a generar otro.
- Un reintento por respuesta incierta conserva el payload completo, el fingerprint y la misma clave idempotente. No se genera otra clave para un envío cuyo resultado no se conoce.
- Tras éxito, se vuelven a consultar los contactos, saldos y obligaciones desde el servidor.
- Cambiar de ficha, cerrar la ficha o cerrar sesión queda bloqueado mientras exista una confirmación cuyo resultado no se haya resuelto.

## Arquitectura y seguridad

El frontend utiliza el cliente Supabase existente únicamente para obtener el JWT vigente y llamar fortuna-dispatch. El dispatcher valida la identidad con Auth y reenvía el mismo JWT a api mediante una allowlist cerrada. Las funciones SQL privadas derivan actor y libro desde auth.uid().

| Acción | Operación | RPC owner-scoped |
| --- | --- | --- |
| Cargar contactos | list_contacts | api.list_contacts |
| Crear contacto | create_contact | api.create_contact |
| Consultar obligaciones | list_obligations | api.list_obligations |
| Abrir obligación | open_obligation | api.open_obligation |
| Vista previa | preview_settlement | api.preview_settlement |
| Recibir dinero | receive_cash | api.receive_cash |
| Pagar contacto | pay_contact | api.pay_contact |

- No existe acceso directo del navegador a tablas privadas, RPC arbitraria, fetch, service_role, almacenamiento local financiero o parámetros de libro/actor suministrados por el cliente.
- El Service Worker no cachea respuestas del dispatcher ni datos financieros.
- La fecha de vencimiento se mantiene fuera del formulario hasta contar con una regla inequívoca de zona horaria.

## PWA y caché

- HTML, versión fallback y Service Worker alineados en V164.
- El shell precarga ui.js?v=164, preview-domain.mjs y api.mjs.
- Se renueva el nombre de caché del shell para que los dispositivos adopten el módulo de liquidación.

## Verificación reproducible

Workflow GitHub-hosted FORTUNA owner UI integration contract:
1. node --check de UI, API y dominio monetario.
2. scripts/verify-fortuna-ui-preview.mjs: navegación owner-only, aislamiento de sesión, seguridad, contrato SQL/Edge, UI de liquidación y V163.
3. scripts/verify-fortuna-api-client.mjs: JWT Bearer, allowlist y argumentos exactos, validación de preview/commit, FIFO/manual, dirección del exceso, error 409 por fingerprint obsoleto, ausencia de sesión e idempotencia.
4. scripts/verify-step10-release.mjs: contrato de release.

- E2E autenticado local [run 45230559473](https://github.com/Robvg9/CuevaCoin/actions/runs/45230559473): SUCCESS sobre el head previo `6fc24fa585d4a0cf367d3325fae47c9327e9b364`. Auth emitió dos JWT; el Edge local con JWT obligatorio y PostgREST local verificaron FIFO, manual, replay de liquidación, HTTP 409 por fingerprint obsoleto, exceso no confirmado rechazado, exceso confirmado convertido en obligación opuesta y aislamiento owner A/B.
- Este E2E usa una pila Supabase desechable de GitHub Actions; aplica migraciones y grants solamente ahí y ejecuta cleanup al terminar. No accede al proyecto Supabase LIVE.
- La aceptación visual en una sesión autenticada de navegador/dispositivo sigue siendo una comprobación de presentación, no una operación financiera de prueba.

## Fase 5 — historial real de movimientos y auditoría (en implementación)

- Se añade una RPC de solo lectura `api.list_activity` detrás del dispatcher autenticado. La función privada resuelve el libro usando `auth.uid()` y comprueba que el contacto pertenezca a ese libro antes de devolver eventos.
- La consulta devuelve eventos financieros ordenados por `occurred_at DESC, id DESC`, con cursor compuesto para paginar sin saltos ni duplicados.
- Cada evento expone tipo, moneda, total exacto, fecha, motivo de reversión cuando corresponda, acción de auditoría y líneas del ledger con descripción e importe.
- No devuelve `financial_audit.details`, UUID del actor, datos de otro propietario ni acceso directo a tablas privadas.
- La UI separa las obligaciones abiertas del historial cronológico, muestra importes exactos y permite cargar páginas anteriores.
- El E2E local añade verificación de cursor, detalle contable, auditoría y rechazo de lecturas cruzadas entre Owner A y Owner B.
- La migración creada por `supabase migration new fortuna_owner_activity_history` es nueva y pendiente de revisión/merge. No se aplicó a Supabase LIVE.
- El código de la rama incorpora el mapeo de `fortuna_stale_preview` a HTTP 409. Supabase LIVE sigue ejecutando `fortuna-dispatch v3`; su actualización requiere el gate de despliegue separado.

## Estado de entrega

- Fase 4: implementación y CI sobre libro/liquidaciones cerrados; PR #66 sigue OPEN/DRAFT y no se ha fusionado ni publicado.
- Fase 5: historial paginado implementado en la rama; requiere CI PASS sobre el SHA final, revisión y aceptación visual antes de considerar cerrado el alcance técnico.
- No se ejecutó ninguna liquidación real ni se modificaron saldos o movimientos de producción.
