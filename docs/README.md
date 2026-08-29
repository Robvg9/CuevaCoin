# CuevaCoin — documentación

## Estado
Rama de consolidación RC. El objetivo es integrar el árbol modular F7 y conservar la infraestructura PWA existente sin modificar `main` hasta completar las verificaciones.

## Fuente de integración
Los artefactos entregados para la consolidación están en `fase7-rc-modular/1/`.

## Regla
No eliminar infraestructura PWA (`service-worker.js`, `manifest.json`, iconos, `.well-known/`, `wrangler.jsonc`) sin evidencia de reemplazo equivalente.

## Gate financiero
La transferencia server-side tiene un blocker confirmado en la implementación actual. No se considera resuelto mediante refactor del cliente; requiere corrección y verificación de Supabase antes de producción.
