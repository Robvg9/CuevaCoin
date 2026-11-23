# FORTUNA v1 — Registro de decisiones de producto

**Estado:** APROBADO por el propietario el 2026-11-21.  
**Alcance:** decisiones vinculantes para el diseño y futura implementación de FORTUNA v1 en CuevaCoin. Este documento no autoriza cambios productivos.

## 1. Presentación de obligaciones opuestas

**Decisión:** una sola ficha por contacto. Dentro de cada moneda, mostrar por separado los importes brutos:

- **Te debe:** total abierto por cobrar al contacto.
- **Le debes:** total abierto por pagar al contacto.

Cuando ambos importes sean mayores que cero en una misma moneda, la ficha muestra **«Posición mixta en [moneda]»** y conserva ambos valores visibles. El contacto no se duplica en dos listas; ninguna cara se oculta y ningún saldo neto sustituye a los importes brutos.

Cuando los sentidos opuestos están en monedas diferentes, mantener una sola ficha en **«Posición mixta por monedas»**, desglosando cada moneda y dirección.

El neto firmado se mantiene para conciliación contable, pero no produce compensación automática. La compensación solo ocurre mediante una acción explícita del propietario para obligaciones del mismo contacto y moneda.

### Criterios de aceptación

- Un contacto con 100 CUP por cobrar y 40 CUP por pagar aparece una sola vez y muestra ambos importes.
- La interfaz no lo coloca como dos contactos ni reemplaza esos importes por «60 CUP netos».
- Una compensación explícita de 40 CUP reduce ambos pendientes en 40 CUP y deja el historial original intacto.
- CUP y USD nunca se netean ni convierten entre sí.

## 2. Catálogo de monedas y precisión

**Decisión:** el catálogo permitido para FORTUNA v1 queda limitado a:

| Código | Escala | Unidades menores por unidad |
|---|---:|---:|
| CUP | 2 | 100 |
| USD | 2 | 100 |
| EUR | 2 | 100 |

- Guardar y calcular importes mediante enteros exactos en unidades menores.
- Rechazar una moneda fuera de la allowlist.
- Rechazar importes con más de dos decimales; no redondear silenciosamente.
- No hay conversión de divisas ni tipos de cambio en v1.
- Añadir una moneda o cambiar su escala requiere un cambio controlado, pruebas y revisión explícita del propietario. No es una configuración libre del cliente.

## 3. Modelo de autorización

**Decisión:** FORTUNA v1 será **owner-only**.

- Solo el propietario autenticado de un libro puede leerlo o modificarlo.
- El servidor obtiene la identidad desde una sesión/token verificado y resuelve el libro por su relación de propietario.
- No se aceptan IDs enviados por el navegador como prueba de identidad o autorización.
- Otro usuario autenticado, un administrador global de CuevaCoin que no sea propietario, un contacto externo y `anon` no tienen acceso.
- V1 no incluye miembros delegados, operador, solo lectura ni una tabla de membresías.
- El acceso futuro de delegados requerirá una decisión de producto y diseño de permisos aparte.

## 4. Consecuencias de implementación

- El modelo de lectura debe agrupar las obligaciones por contacto y moneda, manteniendo los dos totales brutos separados.
- Los cálculos y la validación de moneda se ejecutan en servidor; el frontend no determina permisos ni exactitud monetaria.
- Las políticas de RLS y grants deben corresponder al propietario del libro y no al rol de administrador global de CuevaCoin.
- La autorización de cada comando debe comprobar `auth.uid() = financial_books.owner_user_id` para el libro resuelto.
- Cualquier función privilegiada debe minimizar su superficie, verificar propiedad dentro del cuerpo y revisarse con advisors de Supabase.

## 5. Prerrequisitos técnicos aún abiertos

Estas decisiones cierran los **gates de producto**, pero no certifican la implementación técnica. Antes de una migración o API productiva se requiere:

1. Pruebas de integración sobre PostgreSQL real con múltiples conexiones para carreras de liquidación e idempotencia. PGlite de una conexión no demuestra concurrencia real.
2. Pruebas aisladas de Supabase Auth/JWT, ownership, RLS, grants, esquema privado y Data API.
3. Validación del límite de confianza del servidor/Edge y revisión de seguridad/advisors.
4. Una PR separada para esquema y operaciones, con CI completo.

## 6. Límites de autorización

La aprobación de este registro no autoriza:

- crear o aplicar migraciones en Supabase LIVE;
- desplegar RPC o Edge Functions;
- cambiar saldos, transferencias, nómina, retiros, caja o inventario;
- crear, liquidar o revertir obligaciones financieras reales;
- usar datos LIVE como fixtures.

Todo cambio LIVE requiere su propio Human Gate explícito.


## V169 — Separación entre contactos FORTUNA y dependientes

- La cuenta de CuevaCoin y el contacto de FORTUNA representan a la misma persona, pero no implican la misma relación de negocio.
- `perfiles.es_dependiente` es la clasificación explícita para nómina y roster de CuevaCoin/BattleCruiser. No es un rol de autenticación ni concede permisos.
- Un contacto vinculado a FORTUNA puede ser:
  - Solo FORTUNA (`es_dependiente = false`): no aparece en roster de dependientes y no puede recibir salarios/bonos por las RPC administrativas.
  - Dependiente y FORTUNA (`es_dependiente = true`): aparece en el roster de dependientes y conserva su libro personal separado.
- Los contactos externos sin perfil CuevaCoin son exclusivamente FORTUNA.
- En cada resultado de búsqueda, el administrador ve la clasificación actual y si ya existe el contacto FORTUNA. Puede cambiar el rol sin vincular ni crear un contacto, o elegir «Solo FORTUNA» / «FORTUNA + dependiente» al vincular. La elección es individual por cuenta.
- El backfill conserva como dependientes los perfiles activos existentes no vinculados a FORTUNA; los perfiles ya vinculados a FORTUNA pasan a solo FORTUNA. Los perfiles nuevos nacen no dependientes hasta clasificación explícita.
- Pagar o cobrar desde FORTUNA solo afecta al libro privado. No toca `perfiles.saldo`, nómina, jornadas ni transacciones de CuevaCoin.
- Re-vincular un perfil existente actualiza su clasificación sin crear otro contacto ni volver a ofrecer el saldo como una obligación inicial; evita duplicar deudas.
- La ficha de cada contacto se abre como diálogo modal flotante desde «Abrir ficha»; no queda renderizada permanentemente bajo el listado.
- Las RPC de nómina individual y de bonos validan `es_dependiente = true` en servidor y bloquean lotes completos antes de cualquier escritura si un destinatario no cumple.
