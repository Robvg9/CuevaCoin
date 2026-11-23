# FORTUNA v1 — Paso 4: contactos y obligaciones persistentes

**Estado:** implementación owner-scoped integrada en PR #66; CI PASS sobre SHA `fe8d4f1944aa4076b371d94bc493b145e457965c`.
**PWA:** V162.
**Alcance de este paso:** consulta y gestión autenticada de contactos y obligaciones abiertas. La liquidación y el historial de eventos completos son capacidades separadas.

## Experiencia disponible

- FORTUNA es una sección compartida para sesiones autenticadas de administrador y trabajador. La propiedad del libro siempre pertenece a la identidad autenticada; un rol de administrador global no concede acceso al libro de otra persona.
- Resumen por moneda, una ficha por contacto, búsqueda por nombre/teléfono y filtro de moneda.
- Detalle con obligaciones abiertas, dirección, principal, pendiente, moneda, descripción y vencimiento cuando exista en el modelo.
- Alta persistente de contacto y apertura persistente de obligación.
- Los importes se conservan en unidades menores enteras y se muestran por separado como **Te debe** y **Le debes**. No hay neteo automático ni conversión de monedas.
- La vista «Obligaciones» representa pendientes abiertos del contacto seleccionado; no se presenta como historial completo de eventos.

## Ruta de datos y seguridad

El frontend usa el cliente Supabase existente únicamente para obtener la sesión actual y llamar al Edge dispatcher `fortuna-dispatch`.

| Acción de la UI | Operación del dispatcher | RPC owner-scoped |
| --- | --- | --- |
| Cargar contactos y resumen | `list_contacts` | `api.list_contacts` |
| Crear contacto | `create_contact` | `api.create_contact` |
| Abrir detalle de obligaciones | `list_obligations` | `api.list_obligations` |
| Registrar obligación | `open_obligation` | `api.open_obligation` |

- El JWT de la sesión actual se transmite como Bearer al dispatcher; el mismo token se valida con Auth y se reenvía a PostgREST.
- El dispatcher recibe una operación de una allowlist cerrada; el navegador no envía nombres de tablas, esquemas, SQL, actor ID ni propietario.
- El frontend no accede directamente a tablas privadas, no usa `service_role`, no crea un segundo cliente privilegiado y no contiene llamadas directas a fetch/RPC.
- Las funciones privadas derivan el actor de `auth.uid()` y resuelven el libro en el servidor.
- Las escrituras requieren claves idempotentes generadas con el generador criptográfico del navegador. Ante una respuesta de red incierta, el formulario conserva temporalmente el payload y la misma clave en la pestaña; no dispara reintentos automáticos ni inventa una clave nueva.
- Los datos transitorios y los formularios se limpian al cambiar de cuenta o cerrar sesión.

## Validación y consistencia

- Nombre de contacto: 1–120 caracteres; teléfono: hasta 40; notas: hasta 1.000.
- Obligación: `receivable` o `payable`; CUP/USD/EUR; importe positivo en unidades menores; concepto 1–500 caracteres.
- `BigInt` para parseo, suma y formato; sin aritmética monetaria de punto flotante.
- Se rechazan valores fuera del rango `bigint` y respuestas del servidor con importes, monedas o estructuras inválidas.
- Los totales visibles proceden del modelo agregado por el servidor. El cliente no calcula el pendiente contable de cada obligación ni altera el ledger.
- La fecha de vencimiento se deja sin captura desde esta interfaz hasta que exista una regla explícita para convertir una fecha local en un instante con zona horaria. No se inventa una hora UTC.

## Ciclo PWA

- HTML, versión fallback y Service Worker alineados en **V162**.
- El shell precarga `ui.js?v=162`, `preview-domain.mjs` y `api.mjs`.
- Las consultas financieras siguen siendo de red; el Service Worker no almacena respuestas del dispatcher ni datos del libro.

## Verificación reproducible

En el workflow GitHub-hosted `FORTUNA owner UI integration contract`:

1. `node --check` de los módulos UI y API.
2. `scripts/verify-fortuna-ui-preview.mjs`: navegación owner-only, ciclo de sesión, no acceso directo a tablas, precisión monetaria, contratos SQL/Edge y V162.
3. `scripts/verify-fortuna-api-client.mjs`: JWT Bearer, allowlist y argumentos exactos de las siete operaciones, validación del modelo de lectura, falta de sesión, generación de clave y manejo HTTP 409/503.
4. `scripts/verify-step10-release.mjs`: regresión del contrato de release.

**Evidencia:** run [45223325032](https://github.com/Robvg9/CuevaCoin/actions/runs/45223325032) SUCCESS sobre el SHA exacto `fe8d4f1944aa4076b371d94bc493b145e457965c`; sintaxis, owner UI, cliente API y Step 10 terminaron correctamente.

## Límites explícitos de este paso

- No incluye pagos/abonos, asignación FIFO/manual, excesos, compensaciones ni reversiones en la UI.
- No incluye historial completo de eventos ni paginación de auditoría.
- El contrato del backend para vista previa y confirmación de liquidación está disponible para el siguiente paso; esta entrega no expone botones de liquidación.
- La PR continúa Draft y no forma parte de `main`; no se ha fusionado ni desplegado desde esta rama.


## Continuidad

**Fase 4 · Paso 4: CERRADO.** La siguiente entrega es el Paso 5: interfaz de vista previa de liquidación, presentación de asignaciones FIFO/manual, exceso explícito y confirmación separada con fingerprint del servidor. El cliente ya contiene el mapeo de los endpoints correspondientes; el Paso 5 construirá el recorrido visual y sus estados de seguridad.
