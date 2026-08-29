/** Fase 3 / Oleada 3 — suscribirRealtimeSaldo */

export function suscribirRealtimeSaldo(usuarioId) {
    if (window.saldoRealtimeChannel) {
        window.supabaseClient.removeChannel(window.saldoRealtimeChannel);
        window.saldoRealtimeChannel = null;
    }
    window.saldoRealtimeChannel = window.supabaseClient
        .channel(`saldo-${usuarioId}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'perfiles',
            filter: `id=eq.${usuarioId}`,
        }, (payload) => {
            const nuevoSaldo = Number(payload?.new?.saldo);
            if (Number.isNaN(nuevoSaldo)) return;

            const saldoEl = document.getElementById('user-saldo');
            if (saldoEl) saldoEl.textContent = nuevoSaldo.toFixed(2);
            const perfilSaldoEl = document.getElementById('perfil-saldo');
            if (perfilSaldoEl) perfilSaldoEl.textContent = nuevoSaldo.toFixed(2);

            const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
            if (usuarioActual && usuarioActual.id === usuarioId) {
                usuarioActual.saldo = nuevoSaldo;
                sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuarioActual));
                // Refresca también la barra de progreso de Meta de
                // Ahorro con el saldo nuevo, si el card está en pantalla.
                if (document.getElementById('meta-ahorro-card')) {
                    window.actualizarMetaAhorroInicio(usuarioActual);
                }
                // F8 (2026-08-07): si el admin desactiva/reactiva la
                // cuenta mientras la sesión sigue abierta en otro
                // dispositivo, este mismo canal de perfiles trae el
                // `estado` nuevo - se aprovecha para no tener que
                // abrir un canal aparte solo para esto.
                if (payload?.new?.estado && payload.new.estado !== usuarioActual.estado) {
                    usuarioActual.estado = payload.new.estado;
                    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuarioActual));
                    aplicarEstadoCuentaDesactivada(usuarioActual);
                }
            }
        })
        .subscribe((status, err) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                console.error('Realtime saldo no se pudo suscribir:', status, err);
            }
        });
}

if (typeof window !== 'undefined') {
    window.suscribirRealtimeSaldo = suscribirRealtimeSaldo;
}
