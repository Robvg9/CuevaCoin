/**
 * CuevaCoin — js/finance/queue/idempotency.js
 * Fase 3 / Oleada 2 — Idempotencia de retiros + dedup notif admin.
 * Copia 1:1. NO cablear todavía.
 */

export function obtenerOCrearRetiroIdempotencyKey() {
    if (window.retiroIdempotencyKeyEnVuelo) return window.retiroIdempotencyKeyEnVuelo;
    try {
        const guardada = sessionStorage.getItem(window.RETIRO_IDEMPOTENCY_STORAGE_KEY);
        if (guardada) {
            window.retiroIdempotencyKeyEnVuelo = guardada;
            return guardada;
        }
    } catch (e) { /* sessionStorage puede fallar en modo privado */ }
    const key = window.generarIdempotencyKey();
    window.retiroIdempotencyKeyEnVuelo = key;
    try { sessionStorage.setItem(window.RETIRO_IDEMPOTENCY_STORAGE_KEY, key); } catch (e) {}
    return key;
}

export function limpiarRetiroIdempotencyKey() {
    window.retiroIdempotencyKeyEnVuelo = null;
    try { sessionStorage.removeItem(window.RETIRO_IDEMPOTENCY_STORAGE_KEY); } catch (e) {}
}

export async function notificarAdminRetiroSiNoDuplicado(solicitudId, mensaje, adminId) {
    if (!adminId || !solicitudId) return;
    const dedupKey = 'notif_retiro_' + solicitudId;
    try {
        if (sessionStorage.getItem(dedupKey)) return;
    } catch (e) {}
    try {
        const { error } = await window.supabaseClient
            .from('notificaciones')
            .insert({ usuario_id: adminId, mensaje: mensaje, leida: false, tipo_evento: 'solicitud_retiro' });
        if (error) {
            console.error('Error notificación retiro:', error);
        } else {
            try { sessionStorage.setItem(dedupKey, '1'); } catch (e) {}
            window.actualizarBadgeNotificaciones(adminId);
        }
        window.supabaseClient.functions.invoke('enviar-push', {
            body: { usuario_id: adminId, mensaje: mensaje, tipo_evento: 'solicitud_retiro' }
        }).catch((err) => console.error('Error push retiro:', err));
    } catch (err) {
        console.error('Error notificando admin retiro:', err);
    }
}

if (typeof window !== 'undefined') {
    window.obtenerOCrearRetiroIdempotencyKey = obtenerOCrearRetiroIdempotencyKey;
    window.limpiarRetiroIdempotencyKey = limpiarRetiroIdempotencyKey;
    window.notificarAdminRetiroSiNoDuplicado = notificarAdminRetiroSiNoDuplicado;
}
