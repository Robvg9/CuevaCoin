# FORTUNA — libro privado, liquidaciones e historial

**Estado técnico:** Fases 4 y 5 implementadas e integradas en `main`. La migración histórica V170 y la importación de Alejandro Batista y Evelyn Leyva están completadas y verificadas en Supabase LIVE.
**Última publicación registrada:** PWA/Service Worker V170; Cloudflare Worker main SHA `d75950e318aff7a799650ee8b6f789006503510f`; Worker Version ID `e9d285db-217a-49c2-8297-e3c278bf5c47`; `fortuna-dispatch` V7 ACTIVE con `verify_jwt=true`.
**PR principales:** [#66 — libro, liquidaciones e historial](https://github.com/Robvg9/CuevaCoin/pull/66), [#69 — separación de dependientes](https://github.com/Robvg9/CuevaCoin/pull/69), [#71 — migración histórica V170](https://github.com/Robvg9/CuevaCoin/pull/71).

## 1. Modelo de datos y separación de ámbitos

- FORTUNA es el libro privado del propietario autenticado para deudas por cobrar y por pagar, independientemente de que la contraparte sea dependiente del negocio.
- CuevaCoin y BattleCruiser gestionan exclusivamente perfiles marcados explícitamente como dependientes.
- Una persona puede existir solo en FORTUNA, solo como dependiente o en ambos ámbitos; los libros no se mezclan.
- La clasificación `perfiles.es_dependiente` está protegida en servidor. Las RPC de salarios y bonos rechazan destinatarios no dependientes.
- Liquidaciones FORTUNA no modifican `perfiles.saldo`, nómina, jornadas ni movimientos de BattleCruiser.

## 2. Contactos, obligaciones y liquidaciones

- Cada libro se deriva de `auth.uid()`; un administrador global no obtiene acceso al libro de otra persona.
- Los contactos y obligaciones se consultan desde el servidor. Los importes se manejan en unidades menores con precisión entera; CUP, USD y EUR se mantienen separados.
- La ficha del contacto se abre en un diálogo modal flotante.
- El flujo de liquidación permite indicar si el propietario recibió o pagó dinero, moneda, importe y método FIFO o manual.
- La vista previa se calcula en el servidor y devuelve asignaciones por obligación, exceso y fingerprint SHA-256.
- Cualquier cambio relevante invalida la vista previa. El servidor vuelve a calcular bajo bloqueo al confirmar y rechaza fingerprints obsoletos con HTTP 409.
- El exceso requiere confirmación expresa antes de crear una obligación en la dirección opuesta.
- Las operaciones son idempotentes. Ante respuesta incierta, se conserva la misma clave y payload; no se crea una segunda liquidación.
- Tras confirmar, la interfaz vuelve a consultar contactos, saldos y obligaciones.
- El historial cronológico se consulta mediante `api.list_activity`, con paginación estable por `occurred_at + event_id`, detalle contable y auditoría acotada al propietario.

## 3. Seguridad

- El navegador usa el JWT vigente y una allowlist cerrada del Edge dispatcher; no accede directamente a tablas privadas ni usa `service_role`.
- Las funciones SQL privadas derivan actor y libro desde `auth.uid()`; no aceptan identidad o libro suministrados por el cliente.
- `fortuna-dispatch` LIVE V7 mantiene `verify_jwt=true`.
- El Service Worker no cachea respuestas del dispatcher ni datos financieros.
- No se ejecutan pagos de prueba sobre registros productivos.

## 4. Evidencia de pruebas automatizadas

- PR #66 integró el libro, liquidaciones e historial. CI y E2E local autenticado cubren dos propietarios, aislamiento, FIFO, asignación manual, repetición idempotente, rechazo HTTP 409 por vista previa obsoleta, exceso sin confirmar y exceso confirmado.
- `scripts/e2e-fortuna-authenticated.mjs` también verifica el historial paginado y el rechazo de lecturas cruzadas entre propietarios.
- `scripts/verify-fortuna-owner-settlement-api.mjs` verifica grants mínimos, acceso directo denegado a tablas privadas, cálculo FIFO/manual, replays, cambios de payload, concurrencia/vista previa obsoleta y exceso.
- PR #69 integró el diálogo modal y la separación segura de dependientes.
- PR #71 integró la migración histórica V170 y sus protecciones de idempotencia y conciliación.
- Estos E2E usan una pila Supabase local desechable de GitHub Actions; no crean pagos ni movimientos en Supabase LIVE.

## 5. Migración histórica V170 — LIVE

La migración LIVE `20261123233558` y la importación autenticada se completaron. Los registros originales de CuevaCoin permanecen intactos.

| Contacto | Historial importado | Saldo fuente preservado | Obligación activa FORTUNA |
| --- | ---: | ---: | ---: |
| Alejandro Batista | 17/17 transacciones | 1.000.780 CUP | 1.000.780 CUP |
| Evelyn Leyva | 22/22 transacciones + 28/28 solicitudes | 140.000 CUP | 140.000 CUP |

- Evelyn incluye tres conciliaciones históricas: 304.000 + 16.000 + 20.000 CUP.
- IDs fuente únicos; cero duplicados; una obligación activa por contacto.
- Las solicitudes de retiro se conservaron como eventos históricos y no se convirtieron en pagos/asientos.
- No se registraron liquidaciones reales durante la migración ni la verificación.

## 6. Criterios de cierre y pendientes reales

**PASS técnico:** separación de dependientes, libro privado, liquidaciones, historial, seguridad owner-scoped, migración V170 y conciliación LIVE.

**HUMAN GATE pendiente:** aceptación visual/funcional del propietario en la PWA autenticada, especialmente apertura/cierre del modal, lectura del historial y recorrido de vista previa de liquidación. Esta comprobación no requiere confirmar un pago.

**Operación real futura:** cuando ocurra un pago legítimo, registrarlo en FORTUNA y verificar que solo cambie la obligación correspondiente y su historial. No se inventarán transacciones para cerrar esta prueba.

**Gobernanza separada:** el repositorio GitHub sigue PUBLIC mientras se evalúa el impacto de cambiarlo a PRIVATE sobre los runners y Actions. Esto no bloquea la integridad de la migración V170 y no debe cambiarse sin revisar esa dependencia.

No declarar aceptación física PASS hasta recibir confirmación del propietario. No declarar toda la misión FORTUNA cerrada al 100 % mientras permanezca ese Human Gate.
