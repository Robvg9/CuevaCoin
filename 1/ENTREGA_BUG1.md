# BUG #1 — Parche frontend retiros (RPC solicitar_retiro)

## Entrega para subida MANUAL

**NO se hizo commit / push / deploy.**

### Repositorio
Robvg9/CuevaCoin

### Rama
main

### Ruta
/index.html

### Versión oficial
v125 (sin cambiar CACHE_NAME ni VERSION-126)

### SHA original
099cc7610620a8e6b785fc6523c973672bb07ff8

### Archivo parcheado
`artifacts/index.html` (~643 KB)

## Cambios quirúrgicos (3 bloques)

### 1) Helpers de idempotency (después de CLAVE_COLA_PENDIENTE)
- `retiroIdempotencyKeyEnVuelo`
- `generarIdempotencyKey()` / `obtenerOCrearRetiroIdempotencyKey()` / `limpiarRetiroIdempotencyKey()`
- `notificarAdminRetiroSiNoDuplicado(solicitudId, mensaje, adminId)` con dedup `notif_retiro_<solicitud_id>`

### 2) `ejecutarAccionDeCola` — case `'retiro'`
- Eliminado: SELECT saldo → INSERT solicitudes_retiro → UPDATE perfiles.saldo
- Usa: `rpc('solicitar_retiro', { p_cantidad, p_motivo, p_idempotency_key })`
- Key: `item.datos.idempotency_key || ('cola-item-' + item.id)` (estable, nunca Date.now en retry)

### 3) `#retiro-form` submit
- Botón disabled **antes** de cualquier await
- Key estable (sessionStorage + memoria); no se limpia en timeout/red
- Offline: `encolarAccion('retiro', { ..., idempotency_key: key })`
- Online: solo RPC; UI con `fila.nuevo_saldo`; sin UPDATE saldo ni INSERT directo
- Errores: `retiro_pendiente_existente` → mensaje claro; red/timeout → "Puedes reintentar; no se duplicará."

## Criterios de aceptación

| # | Criterio | Estado |
|---|----------|--------|
| A | Online usa rpc('solicitar_retiro') | OK |
| B | Offline (cola) usa rpc('solicitar_retiro') | OK |
| C | No INSERT directo solicitudes_retiro en flujo usuario | OK |
| D | No UPDATE perfiles.saldo para reservar retiro | OK |
| E | Key estable en retry/timeout | OK |
| F | Doble click bloqueado (disabled inmediato) | OK |
| G | Dedup notificaciones por solicitud_id | OK |
| H | admin_resolver_retiro / aprobar / rechazar intactos | OK |

## No tocado
Supabase, service-worker.js, CACHE_NAME, VERSION-126*, admin, transferencias, chat, auth.

