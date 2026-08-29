/**
 * CuevaCoin — js/finance/architecture.js
 * Fase 3 / Oleada 1 — Mapa de arquitectura financiera (solo documentación ejecutable).
 * No altera comportamiento. Expone un inventario para auditoría.
 */

export const FASE3_FINANCE_MAP = {
  queue: {
    module: 'js/finance/queue/offline-queue.js',
    functions: ['encolarAccion','ejecutarAccionDeCola','sincronizarColaPendiente','obtenerColaPendiente','guardarColaPendiente','actualizarIndicadorColaPendiente'],
  },
  idempotency: {
    module: 'js/finance/queue/idempotency.js',
    functions: ['obtenerOCrearRetiroIdempotencyKey','limpiarRetiroIdempotencyKey','notificarAdminRetiroSiNoDuplicado'],
  },
  saldo: {
    modules: ['js/finance/saldo/saldo-realtime.js','js/finance/saldo/meta-ahorro.js','js/finance/saldo/mascota-saldo.js','js/finance/saldo/inicio-usuario.js'],
  },
  transfers: {
    modules: ['js/finance/transfers/ejecutar-transferencia.js','js/finance/transfers/favoritos.js','js/finance/transfers/qr-scanner.js','js/finance/transfers/modal-transfer.js','js/finance/transfers/password-confirm.js','js/finance/transfers/buscar-usuario.js'],
  },
  withdrawals: {
    modules: ['js/finance/withdrawals/admin-retiros.js','js/finance/withdrawals/admin-solicitudes-ui.js'],
    note: 'Form submit de solicitar_retiro permanece en legacy hasta cableado controlado',
  },
  history: {
    modules: ['js/finance/history/historial.js','js/finance/history/pdf-export.js','js/finance/history/comprobantes.js','js/finance/history/filtros.js'],
  },
  chat: {
    dir: 'js/chat/',
  },
  adminFinance: {
    dir: 'js/admin/finance/',
  },
  orchestration: {
    dir: 'js/finance/orchestration/',
  },
  protectedInLegacyUntilWiring: [
    'submit handlers de retiro-form / transferir-form',
    'listeners de online/offline de cola',
    'OAuth Google pesado',
  ],
};

export function getFase3FinanceMap() {
  return FASE3_FINANCE_MAP;
}

if (typeof window !== 'undefined') {
  window.FASE3_FINANCE_MAP = FASE3_FINANCE_MAP;
  window.getFase3FinanceMap = getFase3FinanceMap;
}
