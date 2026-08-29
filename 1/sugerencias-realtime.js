/**
 * CuevaCoin — js/admin/sugerencias-realtime.js
 * Canal Realtime de la tabla sugerencias — Oleada 7.
 * Solo actualiza lista/dot de Bonos; no toca retiros ni saldo.
 */

export function suscribirRealtimeSugerencias(esAdmin) {
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    if (!client) return;

    if (window.sugerenciasRealtimeChannel) {
        client.removeChannel(window.sugerenciasRealtimeChannel);
        window.sugerenciasRealtimeChannel = null;
    }
    window.sugerenciasRealtimeChannel = client
        .channel(esAdmin ? 'sugerencias-admin' : 'sugerencias-usuario')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'sugerencias',
        }, () => {
            if (typeof window.actualizarBonosDot === 'function') {
                window.actualizarBonosDot(esAdmin);
            }
            const seccionBonosVisible = !document.getElementById(esAdmin ? 'admin-bonos' : 'user-bonos').classList.contains('hidden');
            if (seccionBonosVisible) {
                if (esAdmin) {
                    if (typeof window.loadAdminSugerencias === 'function') window.loadAdminSugerencias();
                } else {
                    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
                    if (usuarioActual && typeof window.loadUserSugerencias === 'function') {
                        window.loadUserSugerencias(usuarioActual.id);
                    }
                }
            }
        })
        .subscribe();
}

if (typeof window !== 'undefined') {
    window.suscribirRealtimeSugerencias = suscribirRealtimeSugerencias;
}
