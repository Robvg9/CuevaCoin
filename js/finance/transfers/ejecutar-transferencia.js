/** Fase 3 / Oleada 4 — ejecutarTransferencia */

const TRANSFER_IDEMPOTENCY_STORAGE_KEY = 'cuevacoin_transfer_idempotency_key';

/** Una key por operación lógica de transferencia; reutilizada en retries. */
function obtenerOCrearTransferIdempotencyKey() {
    if (window.transferIdempotencyKeyEnVuelo) return window.transferIdempotencyKeyEnVuelo;
    try {
        const guardada = sessionStorage.getItem(TRANSFER_IDEMPOTENCY_STORAGE_KEY);
        if (guardada) {
            window.transferIdempotencyKeyEnVuelo = guardada;
            return guardada;
        }
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
    const msg = [
        error && (error.message || error.name || error.code),
        data && data.error
    ].filter(Boolean).join(' ');
    return /timeout|fetch|network|Load failed|Failed to fetch|ERR_NETWORK|ERR_INTERNET|503|502|504/i.test(String(msg || ''));
}

export async function ejecutarTransferencia(destinatarioCorreo, cantidad, motivo) {
    // Una sola key para esta operación (online retries y/o cola offline)
    const idempotencyKey = obtenerOCrearTransferIdempotencyKey();

    // Punto 36c: no se puede validar destinatario/saldo real sin
    // internet (RLS no deja leer el perfil de otro trabajador desde
    // el cliente), así que se encola tal cual y esa validación
    // completa la hace la Edge Function al sincronizar.
    if (!navigator.onLine) {
        window.encolarAccion('transferir', {
            destinatarioCorreo: destinatarioCorreo,
            cantidad: cantidad,
            motivo: motivo,
            idempotencyKey: idempotencyKey
        });
        // La key queda en la cola; limpiar la de sesión para no reutilizarla
        // en una transferencia nueva distinta.
        limpiarTransferIdempotencyKey();
        window.closeModal('transferir-modal');
        document.getElementById('transferir-form').reset();
        window.transferenciaViaQR = false;
        return;
    }

    // El saldo, la validación de "no transferirte a ti mismo", que el
    // correo exista y que el destinatario esté verificado se validan
    // en el servidor (Edge Function "transferir-saldo" con
    // service_role), no aquí en el cliente, porque un trabajador no
    // puede leer el perfil de otro por RLS.
    const { data, error } = await window.supabaseClient.functions.invoke('transferir-saldo', {
        body: { destinatarioCorreo, cantidad, motivo, idempotencyKey }
    });

    if (error || data?.error) {
        console.error(error || data.error);
        // Transporte: conservar key para que un reintento use la misma.
        // Error de negocio: limpiar para que el próximo intento sea operación nueva.
        if (!esErrorTransporteTransferencia(error, data)) {
            limpiarTransferIdempotencyKey();
        }
        window.showToast(await window.extraerMensajeErrorEdgeFunction(error, data), 4000);
        window.closeModal('transferir-modal');
        window.transferenciaViaQR = false;
        return;
    }

    limpiarTransferIdempotencyKey();

    // Reflejar el nuevo saldo (el que confirma el servidor) en la sesión y la UI
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    usuario.saldo = data.nuevoSaldo;
    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
    document.getElementById('user-saldo').textContent = data.nuevoSaldo.toFixed(2);
    document.getElementById('perfil-saldo').textContent = data.nuevoSaldo.toFixed(2);

    window.showToast(`Transferencia de $${cantidad.toFixed(2)} enviada`, 3000);
    window.closeModal('transferir-modal');
    document.getElementById('transferir-form').reset();
    window.transferenciaViaQR = false;

    // Punto 43: revisar si esta transferencia desbloqueó el chat
    // privado con esta persona por primera vez, y felicitar.
    verificarPrimeraTransferenciaYFelicitar(usuario.id);
}

if (typeof window !== 'undefined') {
    window.ejecutarTransferencia = ejecutarTransferencia;
}
