# CUEVACOIN — TRANSFER FORENSIC DESIGN — CONTINUIDAD

## Estado
- Proyecto: CuevaCoin
- Project ID: `zqgmjwfvluboiporytcq`
- Región: `ca-central-1`
- PostgreSQL: `17.6.1.155`
- Modo: solo lectura / diseño
- Branch creado: no
- SQL ejecutado: no

## Causa raíz
`transferir-saldo` no tiene identidad server-side de operación, no usa idempotency key, no bloquea el emisor antes de validar saldo y ejecuta cambios financieros separados.

## Evidencia
Gate 3 identifica `transferir-saldo`, versión 8, ACTIVE, `verify_jwt=true`. Su flujo es: autenticar → leer emisor → leer receptor → calcular saldos absolutos → update emisor → update receptor → transacciones → notificación → push → auditoría.

## PostgreSQL
Tablas financieras:
- `perfiles`
- `transacciones`
- `solicitudes_retiro`
- `notificaciones`
- `auditoria`

No existe RPC pública de transferencia ni tabla pública `transferencias` en el schema inspeccionado.

## Retiro como referencia
`solicitar_retiro` usa `FOR UPDATE` sobre `perfiles` y `idempotency_key` con UNIQUE parcial. Transferencia debe adoptar el mismo principio de locking server-side.

## Diseño elegido
Crear `public.transferencias` como identidad operacional, con `idempotency_key UNIQUE`, y añadir `transferencia_id` a `transacciones`.

RPC:
`registrar_transferencia(p_destinatario_id, p_cantidad, p_motivo, p_idempotency_key)`

Secuencia:
1. auth
2. validar key
3. lookup idempotencia
4. resolver receptor
5. lock determinista de ambos perfiles
6. validar saldo
7. insertar transferencia
8. débito
9. crédito
10. ledger débito
11. ledger crédito
12. auditoría
13. notificación
14. commit

Push queda fuera de la transacción.

## SQL
`SQL_PROPOSED/001_transferencia_atomica_idempotente.sql`

Estado: PROPUESTO / NO EJECUTADO.

## Pruebas futuras
- normal
- saldo insuficiente
- misma key
- misma key simultánea
- payload mismatch
- keys diferentes
- 2/5/10 requests concurrentes
- transferencias cruzadas
- transferencia + retiro
- timeout/retry
- dos pestañas/dispositivos
- rollback
- ledger/auditoría
- invariantes de conservación de saldo

## Riesgos
- otras operaciones futuras podrían saltarse el mecanismo;
- grants directos actuales necesitan hardening;
- push externo no es transaccional;
- `admin_pagar_saldo` acepta arrays con posibles UUIDs repetidos.

## Próximo paso
Revisar/adaptar el SQL propuesto contra el schema exacto y, únicamente en una futura misión explícita y entorno seguro, implementar y probar.

NO declarar FIXED hasta completar implementación y pruebas.
