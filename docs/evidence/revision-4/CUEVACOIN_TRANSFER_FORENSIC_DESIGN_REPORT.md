# CUEVACOIN — TRANSFER FORENSIC DESIGN REPORT

**Fecha:** 2026-08-29  
**Modo:** SOLO LECTURA / DISEÑO / CERO MODIFICACIONES  
**Proyecto:** CuevaCoin  
**Project ID:** `zqgmjwfvluboiporytcq`  
**Región:** `ca-central-1`  
**PostgreSQL:** `17.6.1.155`  
**Estado:** `ACTIVE_HEALTHY`

# VEREDICTO

## READY FOR SAFE IMPLEMENTATION

La causa raíz está identificada y existe una arquitectura única para una futura implementación controlada. **NO significa FIXED.**

```text
PRODUCTION DATA MODIFIED: 0
FINANCIAL OPERATIONS EXECUTED: 0
SCHEMA MODIFIED: 0
RPC MODIFIED: 0
EDGE FUNCTIONS MODIFIED: 0
RLS MODIFIED: 0
DEPLOY: 0
PUSH: 0
MERGE: 0
DEVELOPMENT BRANCH CREATED: 0
COST INCURRED: $0
```

# 1. IDENTIDAD

Proyecto confirmado como CuevaCoin: `zqgmjwfvluboiporytcq`, región `ca-central-1`, estado `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.155`.

# 2. INVENTARIO

Tablas financieras relevantes: `perfiles`, `transacciones`, `solicitudes_retiro`, `notificaciones`, `auditoria`.

`perfiles` contiene `saldo numeric(12,2) NOT NULL DEFAULT 0`, `es_admin`, `estado`, `numero_cuenta UNIQUE` y `usuario UNIQUE`.

`transacciones` contiene PK `id`, `usuario_id`, `admin_id`, `contraparte_id`, `tipo`, `cantidad`, `saldo_antes`, `saldo_despues`, `motivo` y `creado_en`. No existe actualmente `transferencia_id` ni `idempotency_key`.

`solicitudes_retiro` contiene `idempotency_key`, PK y UNIQUE parcial sobre la key, además de UNIQUE parcial para una solicitud pendiente por usuario.

No existe tabla pública `transferencias` ni tabla pública de idempotencia específica para transferencias.

# 3. RPC Y FUNCIONES

Funciones financieras identificadas:

- `admin_pagar_saldo(uuid[],numeric,text,text)`
- `admin_resolver_retiro(uuid,boolean)`
- `admin_resolver_retiro(uuid,text)`
- `solicitar_retiro(numeric,text,text)`
- `es_admin()`
- `proteger_columnas_sensibles_perfil()`
- `avisar_meta_ahorro_alcanzada()`

No existe una RPC financiera de transferencia en el PostgreSQL inspeccionado.

`solicitar_retiro` es `SECURITY DEFINER`, owner `postgres`, `search_path=public`, y utiliza `FOR UPDATE` sobre el perfil.

Las funciones administrativas son `SECURITY DEFINER` y comprueban autorización administrativa. Los grants amplios detectados en Gate 3 quedan como hardening separado.

# 4. EDGE FUNCTION

La ruta financiera actual es **`transferir-saldo`, versión 8, ACTIVE, `verify_jwt=true`**.

Flujo:

```text
CLIENTE
 ↓
transferir-saldo
 ↓
autenticación JWT
 ↓
lectura saldo emisor
 ↓
lectura saldo destinatario
 ↓
cálculo de saldos absolutos
 ↓
UPDATE emisor
 ↓
UPDATE destinatario
 ↓
INSERT transacciones
 ↓
notificación / push
 ↓
auditoría
 ↓
respuesta
```

No existe una frontera transaccional PostgreSQL única para todo el movimiento.

# 5. IDEMPOTENCIA

## Transferencia: NO EXISTE

No hay `idempotency_key` persistida, tabla de operaciones, UNIQUE de operación, deduplicación server-side ni RPC de transferencia.

El mutex del cliente no constituye protección server-side.

Consecuencia: un retry representa una nueva request lógica.

# 6. CONCURRENCIA — CAUSA RAÍZ

La función lee saldo sin lock, valida contra el valor leído, calcula saldos absolutos y posteriormente realiza UPDATE separados.

Escenario:

```text
Inicial:
Emisor = 100
A = 0
B = 0

T1 lee Emisor = 100
T2 lee Emisor = 100

T1 valida 100 >= 80
T2 valida 100 >= 80

T1 calcula Emisor = 20
T2 calcula Emisor = 20

T1 escribe Emisor = 20
T2 escribe Emisor = 20

T1 acredita A = 80
T2 acredita B = 80
```

Resultado posible:

```text
Emisor = 20
A = 80
B = 80
Total inicial = 100
Total final = 180
```

La operación puede crear saldo neto. Esto constituye el BLOCKER confirmado por Gate 3.

# 7. LOCKS

Transferencia actual:

- emisor: NO
- receptor: NO
- operación: NO
- idempotencia: NO

Retiro:

- `perfiles` con `FOR UPDATE`: SÍ

La transferencia no comparte actualmente el mismo mecanismo de serialización que retiro.

# 8. ATOMICIDAD

Transferencia actual: **NO ATÓMICA**.

Los cambios se ejecutan mediante operaciones separadas desde la Edge Function. Un rollback manual desde JavaScript no equivale a una transacción PostgreSQL.

Puede producirse un estado de saldo modificado con ledger/auditoría incompletos si un side effect posterior falla.

# 9. LEDGER

El ledger actual es `transacciones`.

No contiene `transferencia_id` ni `idempotency_key` y no tiene una constraint que represente una única operación lógica de transferencia.

Por ello su PK evita IDs duplicados, pero no evita repetir la misma transferencia lógica.

# 10. AUDITORÍA

La auditoría está en `auditoria`.

En el flujo actual se registra después de cambios financieros y no constituye una garantía transaccional del movimiento.

En el diseño recomendado, la auditoría financiera obligatoria estará dentro de la misma transacción. Push externo queda fuera de la frontera financiera.

# 11. RLS

RLS está habilitado en las tablas financieras relevantes: `perfiles`, `solicitudes_retiro`, `transacciones`, `notificaciones` y `auditoria`.

Las policies restringen principalmente lectura/mutación por usuario y administración. RLS no corrige la race condition de la transferencia.

# 12. PRIVILEGIOS

La nueva RPC propuesta debe tener:

```text
anon          → NO EXECUTE
authenticated → EXECUTE
service_role  → solo si existe necesidad operacional explícita
```

Las mutaciones directas sobre tablas financieras y grants administrativos actuales requieren hardening separado.

# 13. DISEÑO ÚNICO DEL FIX

Arquitectura recomendada:

```text
Cliente / cola
 ↓
Edge Function fina
 ↓
RPC registrar_transferencia
 ↓
idempotency record
 ↓
lock determinista emisor + receptor
 ↓
validación saldo bajo lock
 ↓
débito + crédito
 ↓
transfer record
 ↓
ledger débito + crédito
 ↓
auditoría
 ↓
notificación
 ↓
COMMIT
```

Crear `public.transferencias` con identidad operacional e `idempotency_key UNIQUE`, y añadir `transferencia_id` a `transacciones`.

# 14. IDEMPOTENCIA PROPUESTA

```text
same key + same canonical payload
→ devolver operación existente

same key + payload diferente
→ idempotency_key_payload_mismatch

same key + otro remitente
→ idempotency_key_conflict

different key
→ operación nueva
```

La key debe quedar ligada al remitente autenticado.

# 15. LOCK PROPUESTO

Bloquear ambas filas de `perfiles` con `FOR UPDATE` en orden determinista por UUID:

```text
min(remitente_id, destinatario_id)
max(remitente_id, destinatario_id)
```

La validación del saldo ocurre después del lock.

# 16. ATOMICIDAD PROPUESTA

Dentro de una única transacción PostgreSQL deben quedar:

- idempotencia;
- locks;
- validación;
- débito;
- crédito;
- registro de transferencia;
- ledger;
- auditoría financiera;
- notificación persistida.

Un fallo obligatorio produce rollback total.

# 17. RETRY / TIMEOUT

Si una request hace COMMIT y la respuesta se pierde, un retry con la misma key debe encontrar la transferencia existente y devolver el resultado sin tocar saldos.

Por definición:

```text
retry ≠ nueva transferencia
```

# 18. INTERACCIÓN CON RETIRO

Retiro ya utiliza `FOR UPDATE` sobre `perfiles`. La transferencia propuesta utilizará el mismo recurso de locking.

Así una transferencia concurrente con un retiro se serializa sobre el saldo del usuario.

# 19. OTRAS OPERACIONES DE SALDO

`admin_pagar_saldo` ya utiliza `FOR UPDATE` sobre perfiles.

Invariante global recomendada:

> Toda operación que modifique `perfiles.saldo` debe adquirir el lock de la fila de perfil antes de validar/modificar saldo y ejecutarse dentro de una frontera server-side adecuada.

# 20. SQL PROPUESTO

El archivo `SQL_PROPOSED/001_transferencia_atomica_idempotente.sql` contiene una migration propuesta. **NO FUE EJECUTADA.**

Incluye creación de `transferencias`, UNIQUE de idempotencia, FK/CHECK/indexes, `transferencia_id` en `transacciones`, RPC `registrar_transferencia`, `SECURITY DEFINER`, `search_path`, grants y RLS propuesta.

Antes de implementación debe verificarse nuevamente el schema exacto de `auditoria`, policies/grants heredados y todas las rutas que modifican saldo.

# 21. PRUEBAS FUTURAS

1. transferencia normal
2. saldo exacto
3. saldo insuficiente
4. monto cero/negativo
5. destinatario inexistente
6. self-transfer
7. misma key repetida
8. misma key simultánea
9. misma key + monto diferente
10. misma key + destinatario diferente
11. misma key desde usuario diferente
12. keys diferentes
13. 2 transferencias simultáneas
14. 5 simultáneas
15. 10 simultáneas
16. transferencias cruzadas
17. transferencia + retiro
18. transferencia + pago admin
19. timeout después de commit
20. retry simultáneo
21. dos pestañas
22. dos dispositivos
23. fallo de ledger
24. fallo de auditoría
25. rollback
26. consistencia de ledger
27. conservación de saldo

# 22. INVARIANTES

```text
saldo nunca negativo
una key = una transferencia
una transferencia = un débito + un crédito
débito = crédito
transferencia no crea dinero
retry no crea transferencia
fallo obligatorio = rollback
ledger referencia transferencia válida
transferencia + retiro respetan el mismo lock
anon no ejecuta RPC financiera
```

# 23. ATAQUE CONTRA EL FIX

El diseño fue atacado conceptualmente contra:

- dos requests con misma key;
- dos keys diferentes para mismo emisor;
- transferencias cruzadas;
- timeout + retry;
- payload alterado;
- fallo de ledger;
- fallo de auditoría;
- fallo de push externo;
- llamada directa a RPC;
- `search_path` de `SECURITY DEFINER`.

La combinación de UNIQUE + transacción + locks deterministas + autorización interna cubre los escenarios principales.

# 24. DECISIONES RECHAZADAS

- Solo frontend: insuficiente.
- Solo mutex: insuficiente.
- Solo UNIQUE en `transacciones`: no representa intención lógica.
- Solo UPDATE condicional: incompleto para idempotencia y ledger/auditoría.
- Advisory lock como mecanismo primario: innecesario cuando el recurso es la fila de `perfiles`.

# 25. RIESGOS RESTANTES

1. Toda futura ruta que modifique saldo debe respetar el mecanismo.
2. Push externo no es transaccional.
3. Grants financieros actuales requieren hardening.
4. `admin_pagar_saldo` acepta arrays con posibles UUIDs repetidos.
5. El SQL propuesto debe revisarse contra el schema exacto antes de ejecutar.
6. La cola debe reenviar exactamente la misma key en retries.
7. No realizar backfill histórico automáticamente.

# 26. CONCLUSIÓN

La causa raíz queda localizada en la Edge Function de transferencia: lecturas sin lock, UPDATE absolutos separados, ausencia de transacción financiera única y ausencia de identidad server-side de operación.

El diseño único recomendado es:

```text
Edge Function fina
→ RPC financiera
→ idempotencia persistida
→ locks deterministas
→ saldo validado bajo lock
→ débito + crédito
→ transferencia + ledger + auditoría
→ COMMIT
```

**READY FOR SAFE IMPLEMENTATION.**

**NO está FIXED.**

**STOP — no implementar automáticamente.**
