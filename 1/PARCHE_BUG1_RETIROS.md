# BUG #1 — Parche frontend retiros (RPC solicitar_retiro)

## Entrega MANUAL (sin commit/push/deploy)

| Campo | Valor |
|--------|--------|
| Repositorio | Robvg9/CuevaCoin |
| Rama | main |
| Ruta | /index.html |
| Versión oficial | **v125** (sin bump) |
| SHA blob original | 099cc7610620a8e6b785fc6523c973672bb07ff8 |
| Archivo | `artifacts/index.html` |

Reemplazar el `index.html` existente en `main` conservando v125.

## Bloques modificados (solo 3)

### A) Helpers tras `CLAVE_COLA_PENDIENTE`
- `obtenerOCrearRetiroIdempotencyKey` / `limpiarRetiroIdempotencyKey` (memoria + sessionStorage)
- `notificarAdminRetiroSiNoDuplicado(solicitudId, mensaje, adminId)` con dedup `notif_retiro_<id>`

### B) `ejecutarAccionDeCola` — case `'retiro'`
- Eliminado: SELECT saldo → INSERT solicitudes_retiro → UPDATE perfiles.saldo
- Usa `rpc('solicitar_retiro', { p_cantidad, p_motivo, p_idempotency_key })`
- Key: `item.datos.idempotency_key || ('cola-item-' + item.id)`

### C) `#retiro-form` submit
- `disabled` inmediato en el botón
- Online: solo RPC; UI con `nuevo_saldo`
- Offline: `encolarAccion` incluye `idempotency_key`
- Timeout/red: no limpia la key; mensaje de reintento sin duplicar

## Verificación post-parche
- `rpc('solicitar_retiro'`: **2** (online + offline)
- INSERT en `solicitudes_retiro` en flujo usuario: **0**
- UPDATE `perfiles.saldo` de reserva en retiro: **0**
- `admin_resolver_retiro` / `aprobarSolicitud` / `rechazarSolicitud`: **intactos**

## No tocado
service-worker, CACHE_NAME, VERSION-126*, transferencias, chat, auth, admin saldo, RLS.
