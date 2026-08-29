/** Fase 3 / Oleada 8 — Realtime solicitudes retiro */

export function suscribirRealtimeSolicitudesRetiro() {
    if (window.solicitudesRetiroRealtimeChannel) {
        window.supabaseClient.removeChannel(window.solicitudesRetiroRealtimeChannel);
        window.solicitudesRetiroRealtimeChannel = null;
    }
    window.solicitudesRetiroRealtimeChannel = window.supabaseClient
        .channel('solicitudes-retiro-admin')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'solicitudes_retiro',
        }, () => {
            window.loadAdminStats();
        })
        .subscribe();
}

if (typeof window !== 'undefined') {
    window.suscribirRealtimeSolicitudesRetiro = suscribirRealtimeSolicitudesRetiro;
}
