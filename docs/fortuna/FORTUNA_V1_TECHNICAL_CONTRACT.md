# MISIÓN FORTUNA — Contrato técnico v1 del libro de obligaciones

**Estado:** contrato técnico y modelo de referencia; **no implementado**.  
**Alcance de esta entrega:** reglas contables, límites de seguridad, matriz de datos y casos de prueba. No crea tablas, RPC, Edge Functions, pantallas ni cambios en Supabase.

## 1. Objetivo y fronteras

Construir en CuevaCoin un libro personal del propietario para registrar obligaciones **por cobrar** y **por pagar**, incluso con personas que no tienen cuenta de CuevaCoin.

Este dominio debe mantenerse separado de:

- perfiles.saldo y de los saldos de las dependientas;
- salarios acreditados en CuevaCoin;
- transacciones de transferencias/retiros del monedero interno;
- caja/efectivo, ingresos de negocios, gastos e inventario;
- cuentas bancarias o transferencias reales.

Registrar una deuda no mueve efectivo ni acredita un saldo CuevaCoin. Los pagos del libro solo se registran cuando el propietario indica que el dinero fue efectivamente recibido o entregado.

## 2. Convenciones contables obligatorias

### 2.1 Signo de la posición

Para cada contacto y moneda, la posición derivada del libro usa:

- **Positiva:** el contacto debe dinero al propietario (**por cobrar**).
- **Negativa:** el propietario debe dinero al contacto (**por pagar**).
- **Cero:** posición liquidada para esa moneda.

No hay conversión automática ni compensación entre monedas. Los totales del panel global se muestran por separado —por cobrar y por pagar— y desglosados por moneda. Nunca se presenta un único total global neteado entre monedas.

La excepción de posición mixta entre monedas se muestra en una sección neutral **«Posición mixta por monedas»**: una sola ficha por contacto, con cada moneda y sentido separados.

Cuando el mismo contacto mantiene simultáneamente obligaciones abiertas por cobrar y por pagar **en la misma moneda**, la interfaz también usa una sola ficha para ese contacto. Dentro de la moneda se muestran por separado los importes brutos **«Te debe»** y **«Le debes»**, con la etiqueta **«Posición mixta en [moneda]»**. La ficha no se duplica en dos listas, ninguna de las dos cantidades se oculta y la interfaz no las sustituye por un saldo neto. La compensación sigue siendo una operación explícita, nunca automática.

### 2.2 Sentido de los pagos y excedentes

El sentido del dinero debe gobernar la aplicación. Esta regla corrige un ejemplo ambiguo de la propuesta funcional anterior:

| Operación real | Primero se aplica a | Si sobra dinero, con confirmación |
|---|---|---|
| El propietario **recibe** dinero del contacto | Obligaciones por cobrar (receivables) | Se crea una nueva obligación **por pagar** al contacto |
| El propietario **entrega/paga** dinero al contacto | Obligaciones por pagar (payables) | Se crea una nueva obligación **por cobrar** al contacto |

Ejemplo: el contacto debe 100 CUP y entrega 120 CUP al propietario. Se aplican 100 CUP; los 20 CUP excedentes solo se registran tras confirmación explícita y crean una obligación por pagar 20 CUP al contacto. En el sentido contrario, si el propietario debía 100 CUP y entrega 120 CUP, el excedente confirmado crea una obligación por cobrar 20 CUP.

Si el importe recibido/entregado excede el pendiente aplicable, el sistema muestra antes de confirmar: importe total, aplicaciones propuestas, obligaciones afectadas, excedente y nueva dirección. Cancelar el preview no escribe nada.

### 2.3 Compensación

- Solo entre obligaciones abiertas del **mismo contacto y la misma moneda**.
- El importe no puede superar el pendiente de cualquiera de las dos obligaciones.
- Una compensación genera un evento explícito con dos aplicaciones vinculadas: reduce la obligación por cobrar y la obligación por pagar por el mismo importe.
- No elimina ni reescribe los registros originales.
- La compensación tiene efecto neto cero sobre la posición firmada del contacto en esa moneda, pero reduce ambos importes brutos pendientes.
- No se permite compensar USD contra CUP, EUR u otra moneda ni aplicar una tasa de cambio implícita.

### 2.4 Varias obligaciones y aplicación FIFO

Una persona puede tener varias obligaciones abiertas y saldadas. Cada obligación conserva su importe y dirección originales.

- FIFO es una **sugerencia de previsualización**, no una asignación silenciosa.
- Se puede elegir una distribución manual.
- La previsualización muestra qué obligación recibe cada importe, cuánto queda pendiente y cualquier excedente.
- La suma de aplicaciones nunca puede superar el importe del evento ni el pendiente de una obligación.

### 2.5 Reversiones

- Los eventos y aplicaciones confirmados son inmutables.
- Una corrección crea una reversión enlazada al evento original y requiere motivo y actor autorizado.
- La reversión genera líneas inversas; no borra ni edita el evento fuente.
- No se puede revertir más cantidad de la que queda reversible, ni revertir una reversión como si fuera un evento original.
- La elegibilidad de reversión y sus efectos sobre asignaciones posteriores se validan transaccionalmente en servidor.

## 3. Modelo de datos conceptual

Los nombres siguientes son contratos propuestos, no migraciones listas para ejecutar. La decisión final de esquema, tipos, claves e índices se hará al preparar la migración aislada.

| Entidad propuesta | Responsabilidad |
|---|---|
| financial_books | Libro separado del dueño; identifica al propietario y su estado |
| (sin tabla de miembros en v1) | El libro es exclusivo de su propietario autenticado; la delegación queda fuera de esta versión |
| financial_contacts | Contrapartes externas o vinculadas de forma verificada a un perfil real |
| financial_currencies | Códigos de moneda admitidos y precisión decimal; no contiene tasas de cambio |
| financial_obligations | Obligación individual, contacto, dirección inicial, importe original, moneda, concepto, fechas y estado derivado |
| financial_events | Cabecera inmutable de reconocer obligación, recibir, pagar, compensar o revertir |
| financial_ledger_entries | Líneas firmadas que explican el efecto de cada evento sobre contacto/moneda/obligación |
| financial_allocations | Aplicaciones de un evento a una o más obligaciones; permite FIFO o distribución manual |
| financial_idempotency | Clave, hash del payload y vínculo al resultado confirmado |
| financial_audit | Rastro de acciones sensibles y cambios no monetarios de contacto/configuración |

### 3.1 Contactos

- El contacto existe independientemente de auth.users y perfiles.
- linked_profile_id será opcional y solo se establecerá tras verificar identidad; nunca por coincidencia automática de nombre/teléfono/correo.
- Una persona externa no recibe Auth UUID ficticio ni contraseña.
- Archivar un contacto no borra obligaciones, libro ni evidencias.

### 3.2 Moneda y precisión

- Cada obligación, evento, línea y asignación lleva moneda explícita.
- El catálogo permitido para FORTUNA v1 queda cerrado a **CUP, USD y EUR**, cada una con escala de **2 decimales** (100 unidades menores por unidad monetaria).
- La allowlist y su escala se validan en servidor. Se rechazan monedas no incluidas y cualquier importe con más de 2 decimales; no se redondea silenciosamente.
- Los importes persistidos y calculados usan enteros en unidades menores; la API transporta cadenas decimales o enteros en unidades menores, nunca `Number` binario como fuente exacta.
- Añadir monedas o cambiar escalas requiere una versión/cambio controlado, pruebas de precisión y revisión explícita; no se permite configuración arbitraria desde el cliente.
- No almacenar ni calcular tipos de cambio en esta primera entrega.

### 3.3 Fuente de verdad y conciliación

- Las líneas firmadas del libro son la fuente de verdad de la posición por contacto/moneda.
- Las obligaciones y asignaciones explican el detalle y el pendiente de cada deuda.
- El total bruto por cobrar y por pagar se calcula por moneda y sentido.
- Debe existir una comprobación transaccional de conciliación: posición firmada = suma de líneas firmadas; pendiente de cada obligación = original menos aplicaciones netas válidas.
- Cualquier cache/agregado será reconstruible y nunca una fuente de verdad.

## 4. Arquitectura de seguridad propuesta

La opción preferida es un esquema interno no expuesto (por ejemplo, private) para las tablas del libro, con un conjunto pequeño de operaciones de servidor explícitas. No se dará acceso CRUD directo desde el navegador a las tablas del libro.

Reglas obligatorias para la implementación:

1. Verificar la sesión autenticada con auth.uid() en cada operación; no confiar en datos de identidad enviados por el cliente.
2. En v1 autorizar exclusivamente al propietario: resolver en servidor el libro cuyo `owner_user_id` coincide con `auth.uid()` de la sesión verificada. Si no existe esa relación, denegar. No aceptar `owner_user_id`, `book_id` ni `actor_user_id` del cuerpo como prueba de autorización; no conceder acceso por `is_admin`.
3. RLS habilitado en todas las tablas como defensa en profundidad y limitado al propietario del libro. No existe membresía delegada ni tabla de miembros en v1.
4. No añadir tablas al conjunto de esquemas expuestos sin justificación. Confirmar grants/default privileges y Data API settings antes de la migración.
5. Si una operación necesita una función SECURITY DEFINER, mantener su lógica mínima en esquema privado, usar search_path vacío/fijo y nombres totalmente cualificados, comprobar dentro del cuerpo que `auth.uid()` es el propietario del libro objetivo, revocar EXECUTE a PUBLIC y anon, y concederlo solo al rol esperado.
6. No usar user_metadata editable como autorización; no exponer claves service_role en el frontend.
7. Las operaciones monetarias se ejecutan en una única transacción servidor-side: comprobar permisos, validar payload, aplicar idempotencia, bloquear las obligaciones necesarias, insertar evento/líneas/asignaciones/auditoría y validar conciliación.
8. No alterar perfiles.saldo, transacciones, RPC de salario, transferencias o retiros existentes.

Supabase documenta que los grants determinan si un rol puede llegar al objeto por Data API y RLS determina qué filas puede tocar; ambos controles deben revisarse juntos. También advierte que SECURITY DEFINER puede omitir RLS, por lo que no se usará como atajo. Véase [Securing your API](https://supabase.com/docs/guides/api/securing-your-api) y [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 5. Idempotencia, concurrencia y atomicidad

- Cada comando financiero lleva una clave idempotente estable.
- La clave se vincula al libro/actor y a un hash canónico del payload.
- Misma clave + mismo hash: devolver el resultado original, sin duplicar líneas.
- Misma clave + payload diferente: rechazar con conflicto explícito.
- Bloquear las obligaciones afectadas en orden estable antes de calcular/confirmar aplicaciones y excedentes.
- Dos pagos concurrentes no pueden aplicar más del pendiente real.
- Evento, líneas, asignaciones, reversión y auditoría se confirman o revierten juntos; no se aceptan escrituras parciales.

## 6. Matriz mínima de permisos

| Actor | Leer libro | Gestionar contactos | Crear obligación/evento | Revertir/compensar | Administrar libro |
|---|---:|---:|---:|---:|---:|
| Propietario autenticado del libro (`auth.uid() = owner_user_id`) | Sí | Sí | Sí | Sí, con motivo/confirmación | Sí |
| Usuario autenticado distinto del propietario | No | No | No | No | No |
| Administrador de CuevaCoin que no sea propietario del libro | No | No | No | No | No |
| Contacto externo o perfil vinculado | No | No | No | No | No |
| anon | No | No | No | No | No |

En v1 no hay roles de operador/lector ni delegación de miembros. Ser administrador global de CuevaCoin no concede acceso al libro personal de otra persona.

## 7. Decisión aprobada — presentación de posiciones mixtas

Decisión aprobada por el propietario el **2026-11-21**:

- Un contacto se representa en una sola ficha, aunque tenga varias obligaciones o sentidos abiertos.
- Para cada moneda, **«Te debe»** (bruto por cobrar) y **«Le debes»** (bruto por pagar) se presentan como cantidades separadas.
- Si ambos lados son mayores que cero en la misma moneda, la ficha muestra **«Posición mixta en [moneda]»** y conserva ambas cantidades visibles. No duplica el contacto en dos listas, no oculta una cara y no presenta un saldo neto como sustituto.
- Si los sentidos opuestos se producen en monedas diferentes, la ficha se agrupa en **«Posición mixta por monedas»**, conservando un par de importes separado para cada moneda.
- El neto firmado sigue siendo una magnitud contable derivada para conciliación; no habilita compensación ni reemplaza la exposición de importes brutos en la interfaz.
- Solo una acción explícita de compensación, confirmada por el propietario, reduce ambas obligaciones del mismo contacto y moneda.

## 8. Contrato de cálculo verificable

- Abrir una obligación por cobrar de 100 genera una posición +100 en su moneda.
- Abrir una obligación por pagar de 100 genera una posición -100.
- Recibir 30 contra una obligación por cobrar reduce su pendiente a 70 y la posición a +70.
- Pagar 30 contra una obligación por pagar reduce su pendiente a 70 y la posición a -70.
- Recibir más que el total aplicable exige confirmar el excedente; con confirmación, el importe excedente abre una obligación por pagar.
- Pagar más que el total aplicable exige confirmar el excedente; con confirmación, el excedente abre una obligación por cobrar.
- Compensar 40 de una obligación por cobrar y otra por pagar de la misma persona/moneda reduce ambos pendientes por 40 y no cambia la posición neta firmada.
- La compensación entre contactos distintos o monedas distintas se rechaza.
- Una reversión crea líneas opuestas vinculadas al evento original; nunca cambia/borrar el original.
- El replay idempotente no produce una segunda operación.
- Ningún flujo FORTUNA escribe en los saldos o historial de salarios de CuevaCoin.

## 9. Pruebas requeridas antes de migración

### Pruebas puras del contrato (sin base de datos)

1. Parseo decimal exacto por escala de moneda y rechazo de precisión superior.
2. Signo correcto al reconocer por cobrar/por pagar.
3. FIFO estable por fecha de origen e ID como desempate.
4. Aplicación parcial y total de pagos.
5. Excedente exige confirmación antes de producir líneas.
6. Excedente recibido crea dirección por pagar; excedente pagado crea dirección por cobrar.
7. Compensación misma persona/moneda, límite por el menor pendiente y efecto neto cero.
8. Rechazo de compensación entre personas o monedas diferentes.
9. Reversión parcial/total dentro de la cantidad todavía reversible.
10. Misma clave/hash idempotente no duplica; misma clave con payload distinto se rechaza.
11. Conciliación del signo y del pendiente.
12. Posiciones mixtas por diferentes monedas se mantienen separadas y no se convierten.
13. Un contacto con deudas por cobrar y por pagar en la misma moneda aparece en una sola ficha, con los dos importes brutos visibles y sin neteo automático.
14. El catálogo v1 acepta solo CUP/USD/EUR a escala 2 y rechaza cualquier otra moneda o precisión excesiva.

### Pruebas PostgreSQL/Supabase (solo en entorno aislado antes de considerar LIVE)

- Allowlist de CUP/USD/EUR, escala 2, parseo exacto y rechazo de monedas o precisión no admitidas.
- RLS y grants para propietario, otro usuario autenticado (incluido un administrador global que no sea propietario) y anon; todos salvo el propietario deben ser denegados.
- No acceso directo a tablas privadas del libro por Data API; las lecturas/escrituras pasan por la superficie de servidor autorizada.
- Atomicidad: ningún asiento parcial ante fallo intermedio.
- Carrera de dos abonos sobre la misma obligación; no sobreaplicar.
- Replay y conflicto idempotente.
- Compensación y reversión con auditoría íntegra.
- Reconstrucción de posiciones desde ledger después de cada caso.
- Confirmar cero cambios en perfiles.saldo, nómina, transferencias y retiros existentes.

## 10. Fuera de alcance de esta PR

- No tablas/migraciones ni cambios de esquema.
- No SQL ejecutado contra LIVE.
- No RPC ni Edge Functions desplegadas.
- No pantallas ni despliegues de la app.
- No cambios de saldo, transferencia, salario, deuda real ni caja.
- No retención destructiva, cron, recordatorios automáticos ni limpieza de auditoría.
- No integración con BattleCruiser, SimpleLife o elToque.

## 11. Puerta para la siguiente entrega

Las tres decisiones de producto quedan cerradas para v1: presentación de obligaciones opuestas con importes brutos separados; catálogo CUP/USD/EUR a escala 2; y acceso owner-only sin miembros delegados. La siguiente etapa ya no debe reabrir esos gates sin una nueva decisión del propietario.

Antes de crear una migración o API productiva todavía se requiere: (1) una suite de integración sobre PostgreSQL real con múltiples conexiones que demuestre las carreras de liquidación e idempotencia; (2) pruebas aisladas de Auth/JWT, ownership, RLS, grants y exposición Data API; (3) revisión del esquema y de los advisors de Supabase; y (4) una PR de implementación separada. Toda aplicación o despliegue en Supabase LIVE necesita su Human Gate independiente. Ninguna de estas decisiones autoriza por sí sola cambios LIVE o movimientos financieros.
