# CUEVACOIN — DEEP SERVER-SIDE FORENSIC VERIFICATION

**Fecha:** 2026-08-29  
**Modo:** SOLO LECTURA / FORENSE / ADVERSARIAL  
**Proyecto Supabase:** CuevaCoin  
**Project ID / Ref:** `zqgmjwfvluboiporytcq`  
**Organización:** `slytrsaxmsqmqwakkhfl`  
**Región:** `ca-central-1`  
**Estado:** `ACTIVE_HEALTHY`  
**PostgreSQL:** 17.6 (build/version reportada por Supabase: 17.6.1.155)  
**Deploy / Push / Merge / Migration / Data mutation:** NO EJECUTADOS

> **Resultado ejecutivo:** el backend de retiros presenta una implementación server-side sólida frente a retries/concurrencia; la transferencia, en cambio, tiene una vulnerabilidad financiera confirmada: `transferir-saldo` hace dos lecturas de saldo y dos `UPDATE` absolutos separados, no usa transacción/lock/RPC atómico ni idempotency server-side. Bajo dos transferencias concurrentes desde el mismo emisor hacia destinatarios distintos puede crearse saldo. El hallazgo es **BLOCKER**.

---

## 1. Identidad

La fuente conectada fue verificada como el proyecto **CuevaCoin**, no `battlecruiser` ni otro proyecto.

Evidencia directa:
- Nombre: CuevaCoin.
- Ref/ID: `zqgmjwfvluboiporytcq`.
- Región: `ca-central-1`.
- Estado: `ACTIVE_HEALTHY`.
- PostgreSQL: 17.6.
- El `current_database()` es `postgres`; el rol de inspección es `postgres`.
- No se ejecutó ninguna operación financiera ni de escritura.

## 2. Inventario

### 2.1 Tablas públicas observadas

El esquema generado por Supabase contiene 12 tablas públicas:

1. `anuncio_app`
2. `auditoria`
3. `chat`
4. `contenido_bonos`
5. `favoritos`
6. `notificaciones`
7. `perfiles`
8. `push_suscripciones`
9. `solicitudes_cambio_correo`
10. `solicitudes_retiro`
11. `sugerencias`
12. `transacciones`

Para Gate 3, las tablas financieras relevantes son:

- `perfiles`
- `solicitudes_retiro`
- `transacciones`
- `notificaciones`
- `auditoria`

No se observaron views/materialized views en el esquema público mediante los tipos generados. No existen secuencias públicas según consulta directa.

### 2.2 Columnas financieras clave

`perfiles`:
- `id uuid NOT NULL`, FK a `auth.users(id)`.
- `saldo numeric NOT NULL DEFAULT 0`.
- `es_admin boolean NOT NULL DEFAULT false`.
- `estado text NOT NULL DEFAULT 'activo'`.
- `numero_cuenta text NOT NULL`, UNIQUE.
- `usuario text NOT NULL`, UNIQUE.

`solicitudes_retiro`:
- `id uuid NOT NULL DEFAULT gen_random_uuid()`, PK.
- `usuario_id uuid NOT NULL`, FK a `perfiles`.
- `cantidad numeric NOT NULL`.
- `estado text NOT NULL DEFAULT 'pendiente'`.
- `idempotency_key text NULL`.
- `resuelto_por`, `resuelto_en`, `creado_en`.

`transacciones`:
- `id uuid NOT NULL DEFAULT gen_random_uuid()`, PK.
- `usuario_id uuid NOT NULL`.
- `contraparte_id uuid NULL`.
- `admin_id uuid NULL`.
- `tipo text NOT NULL`.
- `cantidad numeric NOT NULL`.
- `saldo_antes numeric NOT NULL`.
- `saldo_despues numeric NOT NULL`.
- `creado_en timestamp with time zone NOT NULL DEFAULT now()`.

### 2.3 Constraints e índices

`solicitudes_retiro` posee:

- PK `solicitudes_retiro_pkey(id)`.
- UNIQUE parcial `ux_solicitudes_retiro_idempotency_key(idempotency_key) WHERE idempotency_key IS NOT NULL`.
- UNIQUE parcial `ux_solicitudes_retiro_un_pendiente_por_usuario(usuario_id) WHERE estado = 'pendiente'`.

`perfiles` posee:
- PK `id`.
- UNIQUE `numero_cuenta`.
- UNIQUE `usuario`.
- FK `id -> auth.users(id)`.

`transacciones` posee:
- PK `id`.
- FKs para `usuario_id`, `admin_id`, `contraparte_id`.

**Importante:** no se observaron CHECK constraints financieros sobre `saldo`, `cantidad`, `tipo` o estados en estas tres tablas.

## 3. RPC

### 3.1 `solicitar_retiro(numeric,text,text)`

- `SECURITY DEFINER`.
- Owner: `postgres`.
- `search_path = public`.
- PL/pgSQL.
- Retorno: `(solicitud_id uuid, nuevo_saldo numeric)`.

Mecanismos relevantes:

1. Exige `auth.uid()` no nulo.
2. Bloquea la fila del perfil del usuario con `FOR UPDATE`.
3. Valida cantidad > 0.
4. Valida cuenta activa y que no sea admin.
5. Busca `idempotency_key` globalmente.
6. Si la key ya pertenece al mismo usuario, devuelve la misma solicitud y no vuelve a tocar saldo.
7. Si la key pertenece a otro usuario, falla con `idempotency_key_conflict`.
8. Mantiene máximo una solicitud pendiente por usuario.
9. Verifica saldo suficiente.
10. Inserta la solicitud y descuenta saldo dentro de la misma ejecución transaccional de PostgreSQL.
11. El índice UNIQUE parcial sobre `idempotency_key` aporta defensa adicional.

### 3.2 `admin_resolver_retiro(uuid,text)`

- `SECURITY DEFINER`.
- Owner: `postgres`.
- `search_path = public`.
- PL/pgSQL.

Protecciones:
- Comprueba `es_admin` del `auth.uid()`.
- Valida `p_accion`.
- `SELECT ... FOR UPDATE` sobre la solicitud.
- Comprueba que siga `pendiente`.
- `SELECT ... FOR UPDATE` sobre el perfil.
- Aprobar: cambia estado y registra transacción, sin volver a descontar saldo.
- Rechazar: cambia estado y devuelve saldo.
- Side effects están dentro de la misma ejecución transaccional.

### 3.3 `admin_resolver_retiro(uuid,boolean)`

Existe además una sobrecarga anterior:

- `SECURITY DEFINER`.
- Owner: `postgres`.
- `search_path = public`.
- Comprueba admin.
- Bloquea solicitud y perfil con `FOR UPDATE`.
- Rechazo devuelve saldo.
- Aprobación no vuelve a descontar.

La coexistencia de ambas firmas no constituye por sí sola un bypass confirmado, pero aumenta superficie y complejidad.

### 3.4 `admin_pagar_saldo(uuid[],numeric,text,text)`

- `SECURITY DEFINER`.
- Owner: `postgres`.
- `search_path = public`.
- Comprueba admin.
- Bloquea cada perfil destino con `FOR UPDATE`.
- Inserta transacción y actualiza saldo.

**Riesgo operativo:** el array de destinatarios no se deduplica. Si una llamada administrativa contiene dos veces el mismo UUID, el loop puede aplicar dos pagos al mismo trabajador. No es un bypass para un trabajador no-admin, pero sí es una condición peligrosa de doble aplicación por entrada administrativa.

## 4. Retiro — ataque forense

### A. Primera ejecución

La llamada bloquea el perfil del usuario, valida saldo y crea `solicitudes_retiro`; el descuento se realiza en la misma ejecución.

**Resultado:** SAFE.

### B. Segunda ejecución con la misma key

La función encuentra la solicitud existente y devuelve el mismo `solicitud_id`.

No vuelve a:
- insertar solicitud;
- descontar saldo;
- cambiar estado.

**Resultado:** SAFE WITH SERVER IDEMPOTENCY.

### C. Dos llamadas simultáneas con la misma key

La protección primaria es el `FOR UPDATE` sobre la fila del perfil del usuario.

Flujo:

`Request A` bloquea perfil → crea solicitud → descuenta → commit.  
`Request B` espera el lock → después ve la solicitud existente → devuelve el mismo resultado.

Además existe UNIQUE parcial sobre `idempotency_key`.

**Resultado:** no se observa una vía para duplicar el descuento mediante dos llamadas concurrentes del mismo usuario.

### D. Timeout después de COMMIT

Si el servidor hace commit y la respuesta se pierde:

retry con la misma key → lookup existente → retorno de la solicitud existente → sin nuevo descuento.

**Resultado:** SAFE.

### E. Cambio de parámetros con la misma key

`same key + different amount` no crea una nueva operación: devuelve la operación existente para el mismo usuario.

Esto evita una segunda aplicación. No existe una validación explícita de igualdad entre payload original y retry, pero el efecto financiero no se repite.

**Resultado:** SAFE respecto a duplicación; contrato podría endurecerse para detectar payload mismatch explícitamente.

## 5. Transferencia — ataque crítico

La transferencia real no está implementada como RPC financiera en PostgreSQL. Existe una Edge Function:

**`transferir-saldo`, versión 8, ACTIVE, `verify_jwt=true`.**

### Flujo observado

1. Verifica `Authorization`.
2. Usa `auth.getUser()` para autenticar.
3. Lee emisor con `service_role`.
4. Lee destinatario con `service_role`.
5. Comprueba estado, saldo, perfil y destinatario.
6. Calcula:
   - `nuevoSaldoEmisor = saldoAntesEmisor - cantidad`
   - `nuevoSaldoDestinatario = saldoAntesDestinatario + cantidad`
7. Ejecuta `UPDATE perfiles` del emisor.
8. Ejecuta `UPDATE perfiles` del destinatario.
9. Si falla el segundo update, intenta revertir el emisor con otro `UPDATE`.
10. Inserta dos transacciones.
11. Inserta notificación.
12. Envía push.
13. Inserta auditoría.

### Problema 1 — no hay idempotency server-side

La entrada esperada es:

`destinatarioCorreo, cantidad, motivo`

No existe `idempotency_key`.

No existe tabla de idempotency para transferencia.

No existe UNIQUE constraint de operación en `transacciones`.

Cada retry es una nueva petición lógica.

### Problema 2 — no existe frontera transaccional única

La transferencia usa múltiples operaciones separadas:

`UPDATE emisor`
→ `UPDATE destinatario`
→ `INSERT transacciones`
→ `INSERT notificación`
→ push
→ `INSERT auditoría`

No existe una RPC atómica que encapsule saldo + ledger.

El rollback manual del emisor ocurre solamente si falla el segundo UPDATE; no cubre fallos posteriores.

### Problema 3 — race condition financiera confirmada por análisis estático

La función lee ambos saldos antes de actualizarlos y luego escribe valores absolutos.

Escenario demostrable:

Estado inicial:

- Emisor = 100
- Destinatario A = 0
- Destinatario B = 0

Request A:
- lee emisor = 100
- calcula emisor = 20
- calcula A = 80

Request B simultánea:
- lee emisor = 100
- calcula emisor = 20
- calcula B = 80

Ambas pasan la comprobación `saldo >= cantidad`.

Después:

- A escribe emisor = 20
- B escribe emisor = 20
- A escribe A = 80
- B escribe B = 80

Estado final posible:

- Emisor = 20
- A = 80
- B = 80

Total inicial = 100.  
Total final = 180.

**Se creó saldo neto de 80.**

No hay lock de fila del emisor y no hay UPDATE condicional del tipo `saldo = saldo - cantidad WHERE saldo >= cantidad`.

### Problema 4 — mismo retry simultáneo al mismo destinatario

Con emisor = 100 y destinatario = 0, dos requests idénticos pueden leer los mismos saldos y ambos escribir:

- emisor = 20
- destinatario = 80

El saldo final no necesariamente se duplica en ese caso, pero sí pueden generarse dos pares de transacciones y dos side effects secundarios.

Eso demuestra que la función no tiene garantía de **exactly-once operation semantics**.

### Problema 5 — timeout + retry

Si Request A completa ambos updates y commit lógico de cada sentencia, pero la respuesta se pierde:

Request B no tiene forma server-side de reconocer que es el mismo intento.

El resultado depende del estado concurrente y del saldo restante.

No existe garantía de exactly-once.

### Problema 6 — side effects después de saldo

El código puede modificar saldos y posteriormente fallar al insertar transacciones, notificaciones o auditoría. Los errores de esos inserts se registran con `console.error` y la función continúa.

Por tanto puede existir:

**saldo cambiado + ledger incompleto + respuesta `success: true`.**

Esto es una inconsistencia financiera/audit trail de severidad alta.

## 6. Saldo y atomicidad

### Retiro

El retiro es atómico en el servidor:

`INSERT solicitud + UPDATE saldo`

se ejecutan dentro de la misma ejecución PostgreSQL.

El `FOR UPDATE` del perfil serializa retiros concurrentes del mismo usuario.

### Transferencia

No es atómica.

El saldo se modifica mediante dos requests SQL independientes desde la Edge Function.

No existe lock explícito.

No existe transacción SQL única.

No existe RPC atómico.

**Conclusión:** el subsistema de transferencia NO cumple la misma garantía que retiro.

## 7. Idempotency

### Retiro

Server-side:

- columna `solicitudes_retiro.idempotency_key`;
- UNIQUE parcial;
- lookup por key;
- lock de perfil;
- key ligada efectivamente al usuario mediante validación;
- key de otro usuario → conflicto.

### Transferencia

No existe:

- idempotency key;
- tabla de idempotency;
- constraint de operación;
- deduplicación;
- RPC de transferencia.

**Conclusión:** Gate 2 detectó correctamente la ausencia de idempotency en la cola de transferencia. El backend confirma el problema.

## 8. Cola / Offline

El backend no recibe una `idempotency_key` desde `transferir-saldo`.

Por tanto:
- retry de cola = nueva transferencia;
- retry desde dos pestañas = nuevas transferencias;
- retry desde dos dispositivos = nuevas transferencias;
- requests fuera de orden = no existe secuenciación server-side;
- no existe deduplicación server-side.

La seguridad de la cola no puede depender solamente de conservar una key en el cliente si el servidor no la consume.

## 9. RLS

RLS está habilitado en las cinco tablas financieras relevantes:

- `perfiles`
- `solicitudes_retiro`
- `transacciones`
- `notificaciones`
- `auditoria`

### Políticas relevantes

`perfiles`:
- usuario ve su perfil;
- admin ve/actualiza perfiles;
- trabajadores no deberían modificar columnas sensibles debido al trigger.

`solicitudes_retiro`:
- usuario crea su propia solicitud;
- usuario ve las propias;
- admin resuelve.

`transacciones`:
- usuario ve propias;
- admin ve;
- insert administrativo restringido por `es_admin()`.

### Defensa adicional de `perfiles`

Existe trigger `proteger_columnas_sensibles_perfil()` que restaura al valor anterior:

- `saldo`
- `es_admin`
- `estado`
- `numero_cuenta`
- `usuario`
- `correo_verificado`
- `fecha_limite_verificacion`

cuando quien actualiza no es admin/service role.

Esto reduce el riesgo de modificación directa del saldo desde el cliente.

### Observación

Los grants de tabla son amplios (`anon` tiene privilegios SQL de tabla), pero RLS limita el acceso por fila. Por tanto **grant amplio + RLS no debe considerarse equivalente a mínimo privilegio**.

## 10. SECURITY DEFINER

Funciones observadas:

1. `es_admin()`
2. `avisar_meta_ahorro_alcanzada()`
3. `admin_pagar_saldo(...)`
4. `admin_resolver_retiro(uuid,boolean)`
5. `admin_resolver_retiro(uuid,text)`
6. `solicitar_retiro(...)`

### Hallazgo confirmado

`admin_pagar_saldo`:
- SECURITY DEFINER.
- callable por `anon`.
- callable por `authenticated`.

`admin_resolver_retiro` ambas sobrecargas:
- SECURITY DEFINER.
- callable por `anon`.
- callable por `authenticated`.

`solicitar_retiro`:
- SECURITY DEFINER.
- callable por `authenticated`.
- no callable por `anon`.

El acceso `anon` a las funciones administrativas es un **grant incorrecto y una superficie de ataque**, aunque las funciones actualmente contienen comprobación de `auth.uid()`/`es_admin` que evita demostrar un bypass directo a dinero para un usuario no autenticado.

Por ello:

**SECURITY FINDING — HIGH (hardening / privilege exposure), no se eleva por sí solo a BLOCKER de pérdida financiera demostrada.**

### `es_admin()`

Tiene `SECURITY DEFINER` y `search_path` no fijado. Supabase Advisor lo marca como `function_search_path_mutable`.

Su cuerpo usa `public.perfiles` explícitamente y devuelve el `es_admin` asociado al `auth.uid()`. No se demostró un bypass financiero directo derivado de este detalle.

## 11. Grants

Verificación directa mediante `has_function_privilege`:

- `anon EXECUTE admin_pagar_saldo` = TRUE.
- `authenticated EXECUTE admin_pagar_saldo` = TRUE.
- `anon EXECUTE admin_resolver_retiro(text)` = TRUE.
- `authenticated EXECUTE admin_resolver_retiro(text)` = TRUE.
- `anon EXECUTE admin_resolver_retiro(boolean)` = TRUE.
- `authenticated EXECUTE admin_resolver_retiro(boolean)` = TRUE.
- `anon EXECUTE solicitar_retiro` = FALSE.
- `authenticated EXECUTE solicitar_retiro` = TRUE.

Tablas financieras:
- `anon` tiene privilegios SQL de tabla.
- RLS está activado.
- El trigger protege columnas sensibles de `perfiles`.

## 12. Triggers

Triggers financieros observados:

### `perfiles.trg_proteger_columnas_sensibles_perfil`

Ejecuta `proteger_columnas_sensibles_perfil()` antes de UPDATE.

Su función no es SECURITY DEFINER.

### `perfiles.trg_avisar_meta_ahorro`

Ejecuta `avisar_meta_ahorro_alcanzada()` antes de UPDATE de `saldo` o `meta_ahorro`.

No se observaron triggers sobre `solicitudes_retiro` o `transacciones`.

No se demostró un trigger que duplique operaciones financieras.

## 13. Constraints

La protección real contra doble retiro está principalmente en:

1. lock de fila `FOR UPDATE`;
2. UNIQUE parcial de idempotency;
3. UNIQUE parcial de una solicitud pendiente por usuario.

La protección equivalente **no existe para transferencia**.

`transacciones.id` es único, pero eso solo impide duplicar el UUID generado; no impide dos filas representando la misma transferencia.

## 14. Edge Functions

Funciones Edge existentes: 10.

Financieramente relevante:

- `transferir-saldo` — ACTIVE, versión 8, `verify_jwt=true`.

Las demás observadas son:
- `crear-trabajador`
- `enviar-push`
- `subir-foto-perfil`
- `enviar-codigo-verificacion`
- `verificar-codigo-correo`
- `crear-cuenta-propia`
- `resolver-cuenta-qr`
- `crear-perfil-google`
- `abandonar-cuenta-google-sin-perfil`
- `resolver-cuenta-usuario`

No se identificó otra Edge Function que implemente la transferencia financiera.

## 15. Migraciones

La base registra 42 migraciones.

Entre las últimas relacionadas directamente con este Gate:

- `20260809141810 retiro_rpc_atomico`
- `20260809142538 crear_admin_resolver_retiro_atomico`
- `20260825192235 secure_withdrawal_idempotency`
- `20260825234205 bug1_retiro_idempotency`
- `20260825234214 bug1_retiro_preserve_amount_validation`
- `20260825234230 bug1_withdrawal_idempotency_rpc`

La historia confirma que el retiro recibió trabajo explícito de atomicidad e idempotency.

No existe una migración equivalente visible en el historial para una RPC de transferencia atómica/idempotente; la transferencia actual vive en la Edge Function `transferir-saldo`.

No se ejecutó ninguna migración.

## 16. Ataques adversariales

| Ataque | Resultado |
|---|---|
| 1. Dos retiros simultáneos | **SAFE** por lock de perfil + una pendiente |
| 2. Misma idempotency key simultánea | **SAFE** por lock + UNIQUE |
| 3. Timeout después de commit del retiro | **SAFE** |
| 4. Retry de retiro | **SAFE** con misma key |
| 5. Dos pestañas retirando | **SAFE** server-side |
| 6. Dos dispositivos retirando | **SAFE** server-side por fila de perfil |
| 7. Transferencia duplicada | **UNSAFE** |
| 8. Saldo insuficiente bajo concurrencia en retiro | **SAFE** |
| 9. Usuario modifica operación ajena vía RLS | **DENEGADO por policies / auth.uid** |
| 10. Usuario llama RPC financiera directamente | Retiro exige autenticación; RPC administrativas tienen grant público pero validan admin |
| 11. `anon` llama SECURITY DEFINER admin | **Permitido a nivel EXECUTE; validación interna rechaza sin admin** |
| 12. Misma key + monto diferente en retiro | No duplica; devuelve operación existente |
| Transferencias concurrentes a destinos distintos | **BLOCKER: posible creación de saldo** |
| Error posterior a actualización de saldos | **HIGH: ledger/side-effects pueden quedar incompletos** |

## 17. Hallazgos

### G3-BLOCKER-01 — Transferencia no atómica + race condition de saldo

**Severity:** BLOCKER  
**Function:** `transferir-saldo` Edge Function v8  
**Mecanismo:** lecturas de saldo + UPDATE absoluto separado por request, sin lock/transacción/idempotency.  
**Flujo:** read sender → read recipient → calculate → update sender → update recipient.  
**Condición:** dos transferencias concurrentes desde el mismo emisor.  
**Ataque:** A y B leen sender=100; ambas envían 80 a destinatarios distintos.  
**Resultado:** ambos calculan sender=20; ambos destinatarios pueden recibir 80.  
**Impacto:** creación de saldo / pérdida financiera / violación de conservación del dinero.  
**Por qué ocurre:** no existe serialización del emisor ni decremento condicional atómico.

### G3-HIGH-02 — Transferencia sin idempotency server-side

**Severity:** HIGH  
**Function:** `transferir-saldo`  
**Mecanismo:** body sin `idempotency_key`; no existe tabla/constraint de deduplicación.  
**Ataque:** timeout → retry.  
**Resultado:** servidor no puede identificar el retry como la misma operación.  
**Impacto:** side effects duplicables y posibilidad de interacción con la race condition financiera.

### G3-HIGH-03 — Transferencia parcialmente aplicada

**Severity:** HIGH  
**Function:** `transferir-saldo`  
**Mecanismo:** múltiples sentencias independientes.  
**Condición:** segundo update falla, o cualquier operación posterior falla.  
**Resultado:** existe rollback manual solo para un caso concreto; los inserts posteriores no abortan la transferencia.  
**Impacto:** saldos y ledger pueden divergir; auditoría/notificación pueden faltar mientras la respuesta final puede seguir siendo success.

### G3-HIGH-04 — SECURITY DEFINER administrativo ejecutable por anon/authenticated

**Severity:** HIGH (privilege exposure / hardening)  
**Functions:** `admin_pagar_saldo`, ambas `admin_resolver_retiro`.  
**Mecanismo:** EXECUTE concedido.  
**Condición:** llamada directa al RPC.  
**Resultado:** las funciones son alcanzables públicamente a nivel SQL/RPC, aunque sus validaciones internas comprueban admin.  
**Impacto:** superficie innecesaria; cualquier regresión de autorización convertiría inmediatamente el grant en explotación directa.

### G3-MEDIUM-05 — `es_admin()` con search_path mutable

**Severity:** MEDIUM  
**Function:** `public.es_admin()`  
**Mecanismo:** SECURITY DEFINER sin `search_path` fijado.  
**Resultado:** Supabase Advisor lo marca.  
**Impacto:** hardening insuficiente; no se demostró explotación financiera directa en la implementación actual porque la tabla se referencia como `public.perfiles`.

### G3-MEDIUM-06 — `admin_pagar_saldo` no deduplica destinatarios

**Severity:** MEDIUM  
**Function:** `admin_pagar_saldo`.  
**Ataque:** enviar el mismo UUID dos veces en `p_destinatarios`.  
**Resultado:** el loop puede pagar dos veces al mismo trabajador.  
**Impacto:** doble aplicación administrativa accidental/maliciosa.

## 18. Riesgos

### Riesgo crítico

La arquitectura financiera no es homogénea:

- **Retiro:** server-side atomic + idempotent.
- **Transferencia:** Edge Function no atómica + no idempotent + vulnerable a concurrencia.

Por tanto no puede afirmarse que CuevaCoin tenga una garantía global de:

> `same logical operation = exactly one financial side effect`

La garantía existe para retiro, **no existe para transferencia**.

### Riesgo de conservación del dinero

El caso de dos transferencias concurrentes a diferentes destinatarios puede aumentar la suma de saldos.

Eso es un defecto financiero fundamental, no un simple bug de UI.

## 19. Recomendaciones

**No se aplicó ninguna.** Esta sección es únicamente prescriptiva.

1. Mover transferencia financiera a una única frontera transaccional PostgreSQL/RPC.
2. Serializar el emisor mediante `FOR UPDATE` o equivalente.
3. Usar actualización relativa/condicional de saldo, no escribir un saldo absoluto calculado a partir de una lectura antigua.
4. Incorporar `idempotency_key` server-side.
5. Crear constraint/registro de idempotency que represente la operación lógica.
6. Hacer que saldo + ambas entradas del ledger sean una sola transacción.
7. Hacer que un error de ledger provoque rollback de los saldos.
8. No devolver `success=true` si cualquier side effect financiero obligatorio falló.
9. Reducir EXECUTE de funciones administrativas al mínimo necesario.
10. Fijar `search_path` de `es_admin()`.
11. Deduplicar destinatarios en pagos administrativos o imponer una garantía equivalente.
12. Añadir pruebas de concurrencia reales en un entorno no productivo antes de cerrar Gate 3.

## 20. VEREDICTO FINAL

# 🔴 BLOCKER

**Razón determinante:** existe una vulnerabilidad financiera confirmada en `transferir-saldo` que permite una condición de carrera capaz de crear saldo cuando concurren transferencias desde el mismo emisor hacia destinatarios distintos.

El HOLD de Gate 2 **es real y debe mantenerse**.

El retiro, por separado, sí presenta evidencia suficiente de protección server-side contra:
- retries;
- timeout + retry;
- misma idempotency key;
- concurrencia del mismo usuario;
- doble solicitud pendiente.

Pero CuevaCoin no puede cerrar la auditoría global mientras la transferencia financiera siga implementada con la arquitectura actual.

---

## Evidencia técnica resumida

### Retiro

`solicitar_retiro` contiene:

- `SELECT ... FROM public.perfiles ... FOR UPDATE`
- lookup de `idempotency_key`
- conflicto de key entre usuarios
- retorno de solicitud existente
- `INSERT solicitudes_retiro`
- `UPDATE perfiles SET saldo = saldo - p_cantidad`
- UNIQUE parcial sobre `idempotency_key`
- UNIQUE parcial sobre una solicitud pendiente por usuario

### Transferencia

`transferir-saldo` contiene:

- lectura de saldo del emisor
- lectura de saldo del destinatario
- cálculo de saldos absolutos
- `UPDATE perfiles` emisor
- `UPDATE perfiles` destinatario
- `INSERT transacciones`
- `INSERT notificaciones`
- push
- `INSERT auditoria`

No contiene:
- `idempotency_key`
- RPC financiera atómica
- `FOR UPDATE`
- transacción SQL única
- constraint de deduplicación de transferencia

**FIN DEL GATE 3 — NO SE REALIZARON CAMBIOS.**