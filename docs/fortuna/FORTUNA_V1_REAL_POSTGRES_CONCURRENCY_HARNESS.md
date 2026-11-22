# MISIÓN FORTUNA — Harness de concurrencia PostgreSQL real

**Estado:** harness de verificación técnica; todavía no es una API productiva.  
**Motor:** PostgreSQL nativo 17.11.0 en Windows x64 mediante `embedded-postgres@17.11.0-beta.19`.  
**Runner:** `CUEVACOIN-WIN`, GitHub Actions self-hosted.  
**Fixtures:** reutiliza sin cambios `fortuna_v1_schema_prototype.sql` y `fortuna_v1_settlement_prototype.sql`.

## 1. Propósito

PGlite ejecuta el prototipo PostgreSQL 17 en un único backend. Eso sirve para validar DDL, constraints, transacciones secuenciales y rollback, pero no demuestra carreras reales entre sesiones independientes.

Este harness arranca un proceso PostgreSQL nativo y abre varios clientes independientes. Las sesiones comparten el mismo servidor, pero cada cliente dispone de su propio backend PostgreSQL y participa en el gestor normal de locks y los índices únicos.

Todo el entorno se crea bajo un directorio temporal del runner. No se conecta a CuevaCoin LIVE, no utiliza datos reales y no requiere ramas pagadas ni Docker.

## 2. Escenarios concurrentes

### A. Dos liquidaciones compiten por el mismo pendiente

Fixture inicial: una obligación por cobrar de 1.000 unidades menores CUP.

1. La sesión A inicia una transacción, registra una recepción de 700 y mantiene sin confirmar la transacción, conservando el lock de la obligación.
2. La sesión B, desde otro backend, intenta registrar otra recepción de 700 con confirmación explícita de excedente.
3. El observador consulta `pg_stat_activity` y exige ver a B bloqueada en un lock real de PostgreSQL antes de continuar.
4. A confirma. B despierta y recalcula el pendiente: solo quedan 300.
5. B aplica 300 y crea una obligación por pagar de 400, porque el excedente estaba confirmado.

**Resultado exigido:** la obligación por cobrar termina en cero; las dos recepciones mantienen su importe bruto de 700 cada una en el libro de eventos; la nueva obligación por pagar es exactamente 400. No se sobreaplica el principal original.

### B. Dos sesiones repiten simultáneamente la misma clave idempotente

1. A reserva una clave y escribe una liquidación dentro de una transacción todavía abierta.
2. B envía la misma clave y el mismo payload desde otro backend.
3. El test exige observar el bloqueo de B en el conflicto de unicidad antes de liberar A.
4. Tras el commit de A, B debe devolver exactamente la respuesta ya confirmada.

**Resultado exigido:** una cabecera de evento, una asignación, una línea de ledger, un registro de auditoría y una sola fila de idempotencia para esa clave. El replay no duplica escrituras.

### C. Conflicto de payload concurrente posterior

La misma clave con un hash de payload distinto debe rechazarse con `fortuna_idempotency_conflict` y no puede añadir filas.

## 3. Qué demuestra y qué no

**Sí demuestra:**
- Dos conexiones TCP independientes contra un proceso PostgreSQL nativo.
- Espera y liberación de locks reales observados por `pg_stat_activity`.
- Recalcular el pendiente después de esperar al commit de otra sesión.
- El bloqueo del índice único de idempotencia, replay y conflicto.
- Conciliación de principal, excedente y ledger tras las operaciones concurrentes.

**No demuestra todavía:**
- Que el código de producción exista: la función llamada sigue siendo `test_commit_settlement_atomic`, exclusiva de `supabase/tests/`.
- Supabase Auth/JWT real, autorización derivada de la sesión, RLS de un proyecto gestionado, Data API ni ejecución dentro de Edge Runtime.
- Diferencias de configuración entre este servidor PostgreSQL nativo y el proyecto Supabase administrado.
- Seguridad productiva de un endpoint todavía no implementado.

## 4. CI y coste

El workflow `.github/workflows/fortuna-postgres-concurrency.yml` ejecuta el test en el runner Windows self-hosted existente. Instala una versión exacta del paquete desde npm y crea un clúster temporal PostgreSQL 17.11.0. No se consume un runner hospedado ni un servicio Postgres de pago.

## 5. Compuertas que siguen vigentes

- Esta prueba amplía la evidencia del harness; no autoriza una migración ni una función productiva.
- Antes de crear esquema/API real, todavía hace falta probar en un entorno Supabase aislado la identidad verificada, owner-only, RLS, grants, esquema privado y Data API.
- La futura implementación necesita una PR propia y una revisión de advisors.
- Todo DDL, RPC/Edge, despliegue, cambio de UI financiera o escritura en Supabase LIVE requiere su propio Human Gate.
- Nunca usar LIVE como base de pruebas ni tocar saldos, transferencias, nómina, retiros, caja o inventario.
