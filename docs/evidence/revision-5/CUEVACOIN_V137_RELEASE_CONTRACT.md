# CuevaCoin — contrato de versión y cierre V.137

**Fecha de revisión:** 2026-10-09  
**Versión objetivo:** `V.137`  
**Live confirmado antes del despliegue:** `cuevacoin-shell-v136`  
**Estado de publicación:** NO PUBLICADO; PR #1 continúa en draft.

## Fuente de verdad y coherencia

La versión que debe mostrar la PWA procede del `CACHE_NAME` del Service Worker activo. Para este release, los marcadores del código fuente deben concordar:

- `service-worker.js`: `cuevacoin-shell-v137`
- `js/core/app.js`: fallback `V.137`
- `index.html`: fallback inline legado `V.137`

Se encontró y corrigió un fallback inline que aún decía `V.135`. Se amplió `scripts/verify-cuevacoin-static.mjs` para impedir que se acepte una incoherencia equivalente en futuros cambios.

## Cambios presentes en la rama candidata

- Historial de movimientos por trabajadora para el panel admin, en modo de solo lectura.
- Etiquetado separado de descuentos administrativos en el historial personal.
- Revalidación del perfil del servidor al recuperar conexión o volver a primer plano.
- No se oculta una alerta offline obsoleta hasta confirmar conectividad real con backend.
- Mensajes explícitos cuando un pago por lote tiene fallos parciales; deduplicación preventiva de destinatarios en cliente.
- Rutas CDN correctas para jsQR y Chart.js, con precarga del Service Worker alineada.
- Contrato estático de versión compartido por Service Worker, módulo principal y fallback inline.
- El formulario admin de ajuste de saldo ya no actualiza saldo e historial en dos llamadas separadas desde el navegador: la rama lo dirige a `admin_ajustar_saldo_atomico`, con clave estable de idempotencia conservada ante respuesta incierta.
- SQL de la RPC y tabla de idempotencia guardado como **propuesta NO EJECUTADA** en `docs/evidence/revision-5/ADMIN_SALDO_ATOMICO_PROPUESTO_NO_EJECUTADO.sql`; el flujo de ajuste en esta rama no debe publicarse hasta validar/aplicar esta función en el proyecto CuevaCoin correcto.

## Verificaciones ejecutadas

- CI de GitHub Actions en el HEAD previo al documento: PASS, incluidos chequeos de sintaxis JS y contrato de versión. El commit con este documento debe volver a pasar CI antes de que se considere verificado el HEAD final.
- Recursos CDN corregidos responden HTTP 200 y sirven JavaScript durante las comprobaciones anteriores.
- LIVE responde HTTP 200, pero la última comprobación física de `https://cuevacoin.robvg9.workers.dev/` encontró `cuevacoin-shell-v136`, las dos URLs CDN antiguas y ausencia del modal `admin-worker-history-modal`.
- No se completó E2E autenticado. La prueba de navegador anterior acabó por timeout de `networkidle2`; no se declara PASS.

## Secuencia de aceptación en producción

1. Publicar la revisión aprobada y confirmar en red que `/service-worker.js` contiene `cuevacoin-shell-v137`.
2. Abrir la PWA, usar **Actualizar app / Limpiar caché**, recargar y confirmar que la versión mostrada sea **V.137** (login, topbar y Configuración). No iniciar pruebas financieras si la versión no coincide.
3. Confirmar que `index.html` contiene el modal de historial administrativo y las URLs nuevas de CDN, y que las bibliotecas cargan sin error.
4. Ejecutar E2E autenticado de admin y trabajadora: historial, filtros, saldo/ledger, reconnect/offline, pagos por lote, retiros y transferencias; capturar evidencia antes/después.
5. Cerrar solo si la integridad del saldo y del ledger queda demostrada bajo fallos/reintentos y concurrencia, y los privilegios/RLS/RPC LIVE han sido inspeccionados.

## Bloqueo explícito para el 100%

El conector Supabase disponible solo enumera el proyecto ARIA (`icuqsstxfdbvjytkhlog`) y responde `You do not have permission` para el proyecto CuevaCoin documentado (`zqgmjwfvluboiporytcq`). La máquina RobVG tampoco tiene en esta sesión un checkout Git de CuevaCoin, Supabase CLI ni credenciales de deploy Cloudflare configuradas en variables de entorno.

Por seguridad no se ejecutaron cambios contra ARIA ni se publicó nada. La rama ha cambiado el cliente de ajuste manual para usar una RPC atómica con idempotencia; sin embargo, la definición SQL adjunta solo está propuesta y **no está aplicada ni validada contra el esquema LIVE**. Por tanto la nueva ruta de cliente depende de una RPC que aún no está confirmada en producción, y esa rama debe mantenerse fuera de LIVE hasta que el proyecto Supabase correcto sea accesible, se inspeccionen columnas/triggers/grants, la RPC se aplique y pase pruebas controladas. La transferencia y los grants/RLS/Auth de producción también deben auditarse contra el estado actual, porque los informes históricos y el checkpoint posterior no coinciden.

**Regla de cierre:** código + CI verde + versión LIVE comprobada + E2E real + evidencia persistida + base de datos/privilegios verificados. En este estado, CuevaCoin sigue EN CURSO, no 100%.
