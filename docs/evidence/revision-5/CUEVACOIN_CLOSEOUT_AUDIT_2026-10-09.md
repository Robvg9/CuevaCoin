# CuevaCoin — revisión de cierre preliminar
**Fecha:** 2026-10-09  
**Estado:** PRELIMINAR — NO CERTIFICADO LIVE  
**Base inspeccionada:** `main` en `bacab3544de81ac33e39bbbdc0b2d06de298cff5` (2026-08-30)  
**Rama de propuesta:** `fix/admin-worker-ledger-sync-recovery`

## Resumen ejecutivo

Se revisaron los registros relevantes de ChatBending/Notion y el código actual de GitHub. El historial del usuario ya tenía una pantalla propia; lo que faltaba era acceso administrativo directo por trabajador, la diferenciación clara entre retiros y descuentos del administrador y corregir una referencia de categoría que podía romper el renderizado/filtro. La ruta de reconexión tampoco volvía a cargar automáticamente el perfil del servidor y la sección visible.

**No puede declararse CuevaCoin cerrado al 100%.** El historial RWHT de ChatBending indica que la auditoría física completa no está realizada ni certificada. No fue posible leer el esquema ni las migraciones del proyecto Supabase de CuevaCoin con la conexión actual; el conector rechazó permiso para el proyecto histórico. No se tocaron ni se hicieron transacciones en el proyecto Supabase de ARIA.

## Visión recuperada y límites de alcance

La documentación específica recuperada (`MIGRACIÓN 4/7 — CuevaCoin`) describe CuevaCoin como una PWA financiera/operativa con autenticación, perfiles/cuentas, saldos, historial de transacciones, transferencias, retiros y chat; hay cola offline y notificaciones. No apareció una visión/roadmap técnico único, actual y completo: la misma migración dice que falta recuperar arquitectura/tablas/RPC/RLS/seguridad/roadmap contra el sistema real.

Los reportes **M26** y **Reporte COMPLETO de Pruebas de Robert** con almacenes, inventario, ventas y turnos pertenecen al árbol documental de **BattleCruiser**. No se agregan como pendientes de CuevaCoin sin evidencia en su repo. El árbol actual de CuevaCoin sí contiene módulos de saldo, pagos admin, transacciones, retiros, transferencias, chat, perfiles, auditoría, estadísticas y PWA; la auditoría física debe partir de esas superficies reales y reconciliar cualquier lista RWHT genérica antes de atribuir módulos.

## Cambios preparados en la rama

- **Historial individual del administrador:** botón en la tarjeta de cada trabajador y modal de solo lectura sobre `transacciones`, paginado por bloques, con filtros por tipo/fecha/texto, motivo, quién registró el movimiento, contraparte y saldos antes/después cuando están guardados.
- **Historial del trabajador:** corrección para usar la función de clasificación local, en vez de una referencia `window.categoriaTransaccion` que no aparece exportada; los movimientos `retiro_admin` negativos se muestran como **Descuento admin**, distintos de un retiro propio. Los pagos del administrador se etiquetan de forma más clara.
- **Recuperación de sincronización:** al reconectar, volver al primer plano o hacer visible la app, se verifica el backend, se relee el perfil desde Supabase y se vuelve a cargar la sección que estaba abierta. Si la sesión o el perfil no pueden confirmarse, no se anuncia una recuperación exitosa.
- **Aviso rojo persistente:** si no hay operaciones en cola, solo se retira un aviso offline antiguo después de confirmar conexión real con el backend.
- **Pagos por lote:** el aviso de fallo parcial ya no queda sobrescrito por un segundo toast que afirma éxito total.
- **Ajuste manual de saldo:** si el saldo se actualiza pero la inserción en `transacciones` falla, la interfaz muestra una advertencia crítica y no confirma éxito. Es una protección temporal, no la solución de integridad definitiva.
- **Versión PWA:** shell cache y fallback visual alineados en v137 para forzar renovación de recursos al desplegar estos cambios.
- **Validación automatizada:** se añadió un workflow de sintaxis e invariantes estáticas. Su estado de GitHub Actions debe comprobarse después de abrir el PR; esa comprobación estática no sustituye E2E.

## Hallazgo financiero crítico

La ruta de “Ajustar Saldo” en `js/legacy-app.js` hace actualmente operaciones separadas:

1. lee `perfiles.saldo`;
2. actualiza `perfiles.saldo`;
3. inserta la fila en `transacciones`;
4. registra notificación y auditoría.

No es una transacción atómica. Si el paso 3 falla, el dinero ya cambió pero el libro de movimientos queda incompleto. Se preparó una advertencia explícita en el cliente, pero **el cierre requiere sustituir esa ruta por una RPC de backend atómica**, después de inspeccionar el esquema/policies reales de CuevaCoin. Debe validar admin en servidor, bloquear la fila del perfil, actualizar el saldo e insertar la transacción y la auditoría dentro de una sola transacción de base de datos; si algo falla, debe revertir todo. No debe usarse el cliente Supabase de ARIA ni inventarse una función inexistente.

También se deben inspeccionar las funciones `admin_pagar_saldo`, `solicitar_retiro` y `admin_resolver_retiro` para asegurar que todas las rutas de dinero escriben saldo y ledger consistentemente.

### Discrepancia histórica que no debe reabrirse a ciegas — transferencias

Los informes históricos de revision-3/4 describían `transferir-saldo` v8 como no atómica/no idempotente y presentaban el SQL de RPC como **propuesto, no ejecutado**. Un checkpoint posterior de ChatBending (2026-08-30) declara que `transferir_saldo_atomica(uuid,numeric,text,text)` se aplicó y se probaron new/replay, key conflict, locks, ledger y rollback; allí quedaba pendiente el frontend. El archivo actual de `main` `js/finance/transfers/ejecutar-transferencia.js` ya genera/persiste y envía `idempotencyKey` al Edge Function. Por eso los informes anteriores no deben interpretarse, sin más, como prueba de que la misma vulnerabilidad sigue activa. Falta verificar el estado **LIVE actual** de la RPC/Edge Function, tabla idempotency, grants/RLS y replay después de timeout. No ejecutar el SQL propuesto antiguo sin comparar primero con el esquema real.

### Hallazgos de seguridad históricos que requieren revalidación

El Gate 3 también registró históricamente: `anon EXECUTE` en sobrecargas administrativas de `admin_resolver_retiro`, grants amplios en tablas aunque RLS limita filas, protección de contraseñas filtradas deshabilitada en Auth, y ausencia de deduplicación de destinatarios en `admin_pagar_saldo` (un arreglo administrativo con UUID repetidos podía pagar dos veces a una persona). No se ha podido comprobar desde esta conexión si estos puntos siguen presentes. Revisar grants/RLS y la configuración Auth actual; aplicar mínimo privilegio; deduplicar destinatarios tanto en el cliente como, como autoridad definitiva, en el servidor; y probar que usuario anónimo/no admin no puede ejecutar movimientos financieros.

## Pendientes para declarar 100%

### P0 — Integridad del libro financiero
- Obtener acceso autorizado de solo lectura al proyecto Supabase correcto de CuevaCoin.
- Inspeccionar columnas, triggers, RPC, políticas RLS y grants actuales.
- Diseñar e implementar la RPC atómica de ajuste admin (depósito/descuento), con motivo obligatorio para ajustes manuales y un resultado definitivo/ID de transacción.
- Probar también la ruta de pago por lote, transferencias, retiros, aprobaciones y devoluciones. Confirmar que no existen escrituras directas adicionales que puedan dejar saldo sin ledger.
- Determinar, con evidencia, si hay ajustes anteriores sin transacción. No inventar filas históricas; cualquier conciliación manual debe indicar su origen y fecha.

### P1 — Pruebas LIVE/E2E
- Workflow estático de GitHub Actions: **SUCCESS** también en la revisión más reciente de la rama (run #5, ID `37928225063`; sintaxis JS, scripts inline e invariantes estáticas PASS). [Ver ejecución](https://github.com/Robvg9/CuevaCoin/actions/runs/37928225063). Esto no sustituye LIVE/E2E.
- Publicar la rama mediante el método de despliegue de CuevaCoin y verificar en producción el shell v137.
- Probar con cuentas controladas de administrador y trabajador: pago, bono, depósito, descuento por cobro en efectivo, transferencia entrante/saliente y retiro aprobado/rechazado. Verificar que ambas vistas muestren la misma fila persistida, motivo, fecha y saldo antes/después.
- Simular inserción fallida/timeout y confirmar que una operación financiera no queda aplicada parcialmente.
- Simular desconexión real y recuperación en admin y trabajador; al volver a primer plano, comprobar actualización sin cerrar sesión ni borrar caché; verificar que el banner rojo desaparece solo tras confirmar backend.
- Verificar permisos reales: trabajador ve solo su ledger; admin ve el de cada trabajador; nadie puede alterar ledger o saldo saltándose las RPC.
- Guardar evidencia (capturas, IDs de transacciones, resultados de consultas y estado de deploy).

### P2 — Auditoría física completa del producto
ChatBending mantiene el RWHT físico como **NO REALIZADO / NO CERTIFICADO**. Completar la matriz descrita allí para login/sesión, dashboard, navegación, acciones/botones, loading/errores/recuperación, responsive móvil/PC y modelo de permisos. Confirmar cuáles superficies corresponden realmente a la versión actual de CuevaCoin antes de añadir alcance nuevo.

## Evidencia de continuidad consultada

- ChatBending / página de CuevaCoin: `https://app.notion.com/p/3ebfeb355ec18197ad1fc6574398eb76`
- ChatBending / RWHT de CuevaCoin: `https://app.notion.com/p/3e8feb355ec181edbf28f297bba6d40a`
- ChatBending / checkpoint CuevaCoin 2026-08-29: `https://app.notion.com/p/3cbfeb355ec181828a8aef207d6a80f6`
- ChatBending / offline y sincronización: `https://app.notion.com/p/3c7feb355ec1810c9f86cbc3eea69b90`
- Código inspeccionado: `js/legacy-app.js`, `js/finance/history/historial.js`, `js/finance/queue/offline-queue.js`, `js/finance/orchestration/procesar-sesion.js`, `js/admin/finance/pagos.js`, `js/admin/finance/usuarios.js`, `service-worker.js`.

**Regla de cierre:** PR aprobado no equivale a LIVE; CI verde no equivale a E2E; saldo actualizado no equivale a ledger correcto. El 100% requiere los tres y evidencia persistida.
