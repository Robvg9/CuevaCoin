# CUEVACOIN — SERVER GATE 3 CONTINUIDAD

## Estado de cierre

**Gate:** 3 — Deep Server-Side Forensic Verification  
**Fecha:** 2026-08-29  
**Proyecto:** CuevaCoin  
**Supabase ref:** `zqgmjwfvluboiporytcq`  
**Región:** `ca-central-1`  
**Estado:** ACTIVE_HEALTHY  
**PostgreSQL:** 17.6  
**Veredicto:** 🔴 BLOCKER

## Qué quedó demostrado

### RETIRO — SERVER-SIDE

La RPC `solicitar_retiro(numeric,text,text)` es:

- SECURITY DEFINER;
- owner postgres;
- `search_path=public`;
- autenticada mediante `auth.uid()`;
- serializada por `SELECT ... FOR UPDATE` sobre `perfiles`;
- protegida por UNIQUE parcial sobre `solicitudes_retiro.idempotency_key`;
- protegida por UNIQUE parcial de una solicitud pendiente por usuario;
- atómica para creación de solicitud + descuento de saldo.

Conclusión:

**Retiro = SAFE WITH SERVER IDEMPOTENCY.**

Timeout después de commit + retry con la misma key no vuelve a descontar.

### TRANSFERENCIA — SERVER-SIDE

La Edge Function `transferir-saldo` v8:

- requiere JWT;
- usa service_role internamente;
- lee saldos;
- calcula nuevos saldos;
- actualiza emisor;
- actualiza destinatario;
- inserta ledger después;
- no recibe idempotency key;
- no tiene deduplicación server-side;
- no tiene transacción SQL única;
- no bloquea el emisor.

Conclusión:

**Transferencia = UNSAFE / BLOCKER.**

## Ataque financiero determinante

Estado:

- Emisor = 100
- A = 0
- B = 0

A y B ejecutan simultáneamente una transferencia de 80.

Ambos pueden leer:

- emisor = 100

Ambos calculan:

- emisor = 20

Y cada uno calcula su destinatario = 80.

Estado final posible:

- emisor = 20
- A = 80
- B = 80

Total final = 180.

Se creó saldo neto de 80.

No fue necesario ejecutar datos reales para demostrarlo: el flujo y las operaciones de la función son suficientes para establecer la race condition.

## Hallazgos prioritarios

1. **BLOCKER:** transferencia no atómica + race condition financiera.
2. **HIGH:** transferencia sin idempotency server-side.
3. **HIGH:** transferencia puede dejar saldos y ledger inconsistentes.
4. **HIGH:** RPC SECURITY DEFINER administrativas tienen EXECUTE para anon/authenticated.
5. **MEDIUM:** `es_admin()` search_path mutable.
6. **MEDIUM:** `admin_pagar_saldo` permite destinatarios repetidos.

## Cambios realizados

**NINGUNO.**

No se ejecutaron:
- INSERT
- UPDATE
- DELETE
- ALTER
- CREATE
- DROP
- migration
- deploy
- push
- merge

No se ejecutó ninguna RPC financiera.

## Qué NO debe interpretarse como resuelto

No debe cerrarse Gate 3 por el hecho de que retiro esté correctamente protegido.

La garantía de retiro no cubre transferencia.

El sistema completo sigue en HOLD/BLOCKER.

## Condición mínima para reabrir auditoría

Una futura revisión debe demostrar, sin tocar producción:

1. transferencia con idempotency server-side;
2. serialización del emisor;
3. atomicidad de débito + crédito + ledger;
4. retry después de timeout sin duplicación;
5. dos pestañas/dispositivos sin doble aplicación;
6. transferencia simultánea a destinatarios distintos sin creación de saldo;
7. fallo intermedio con rollback completo;
8. ledger y saldos siempre consistentes.

**STOP — no se aplicaron correcciones durante Gate 3.**