/** Fase 3 / Oleada 4 — ejecutarTransferencia mediante ID interno */
const TRANSFER_IDEMPOTENCY_STORAGE_KEY = 'cuevacoin_transfer_idempotency_key';
function obtenerOCrearTransferIdempotencyKey() {
    if (window.transferIdempotencyKeyEnVuelo) return window.transferIdempotencyKeyEnVuelo;
    try {
        const guardada = sessionStorage.getItem(TRANSFER_IDEMPOTENCY_STORAGE_KEY);
        if (guardada) { window.transferIdempotencyKeyEnVuelo = guardada; return guardada; }
    } catch (e) { /* sessionStorage puede fallar en modo privado */ }
    const key = (typeof window.generarIdempotencyKey === 'function')
        ? window.generarIdempotencyKey()
        : ('tx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
    window.transferIdempotencyKeyEnVuelo = key;
    try { sessionStorage.setItem(TRANSFER_IDEMPOTENCY_STORAGE_KEY, key); } catch (e) {}
    return key;
}
function limpiarTransferIdempotencyKey() {
    window.transferIdempotencyKeyEnVuelo = null;
    try { sessionStorage.removeItem(TRANSFER_IDEMPOTENCY_STORAGE_KEY); } catch (e) {}
}
function esErrorTransporteTransferencia(error, data) {
    if (typeof window.esErrorDeConexion === 'function' && window.esErrorDeConexion(error)) return true;
    const msg = [error && (error.message || error.name || error.code), data && data.error].filter(Boolean).join(' ');
    return /timeout|fetch|network|Load failed|Failed to fetch|ERR_NETWORK|ERR_INTERNET|503|502|504/i.test(String(msg || ''));
}
export async function ejecutarTransferencia(destinatarioId, cantidad, motivo, destinatarioNombre) {
    if (!destinatarioId) throw new Error('Selecciona un destinatario válido antes de transferir.');
    const idempotencyKey = obtenerOCrearTransferIdempotencyKey();
    const nombreVisible = String(destinatarioNombre || 'Destinatario');
    if (!navigator.onLine) {
        // New queue intents store a stable profile ID, never recipient email.
        window.encolarAccion('transferir', {
            destinatarioId, destinatarioNombre: nombreVisible, cantidad, motivo, idempotencyKey
        });
        limpiarTransferIdempotencyKey();
        window.closeModal('transferir-modal');
        document.getElementById('transferir-form').reset();
        window.transferenciaViaQR = false;
        window.transferenciaDestinatarioSeleccionado = null;
        return;
    }
    const { data, error } = await window.supabaseClient.functions.invoke('transferir-saldo', {
        body: { destinatarioId, cantidad, motivo, idempotencyKey }
    });
    if (error || data?.error) {
        console.error(error || data.error);
        if (!esErrorTransporteTransferencia(error, data)) limpiarTransferIdempotencyKey();
        window.showToast(await window.extraerMensajeErrorEdgeFunction(error, data), 4000);
        window.closeModal('transferir-modal');
        window.transferenciaViaQR = false;
        return;
    }
    limpiarTransferIdempotencyKey();
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    usuario.saldo = data.nuevoSaldo;
    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
    document.getElementById('user-saldo').textContent = data.nuevoSaldo.toFixed(2);
    document.getElementById('perfil-saldo').textContent = data.nuevoSaldo.toFixed(2);
    window.showToast('Transferencia de $' + cantidad.toFixed(2) + ' enviada a ' + nombreVisible, 3000);
    window.closeModal('transferir-modal');
    document.getElementById('transferir-form').reset();
    window.transferenciaViaQR = false;
    window.transferenciaDestinatarioSeleccionado = null;
    verificarPrimeraTransferenciaYFelicitar(usuario.id);
}
if (typeof window !== 'undefined') window.ejecutarTransferencia = ejecutarTransferencia;
