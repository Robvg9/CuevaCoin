/**
 * CuevaCoin — js/session/logout.js
 * Cierre de sesión + limpieza de canales Realtime (Oleada 4).
 * No opera retiros/transferencias/saldo; solo cierra canales y limpia storage.
 */

export async function logout() {
    // F2 (fix): antes no había ningún indicador visual mientras
    // cerraba canales de Realtime/limpiaba sessionStorage - se veía
    // "trabado". Reusa el mismo spinner de (window.mostrarCargando && window.mostrarCargando())/
    // (window.ocultarCargando && window.ocultarCargando()) que ya usa el resto de la app, con
    // try/finally para garantizar que se oculte pase lo que pase.
    (window.mostrarCargando && window.mostrarCargando());
    try {
    // Punto 7f: cerrar el canal de chat en vivo antes de salir, para
    // no dejarlo escuchando de fondo con la sesión ya cerrada.
    if (window.chatRealtimeChannel) {
        window.supabaseClient.removeChannel(window.chatRealtimeChannel);
        window.chatRealtimeChannel = null;
    }
    // Punto 38a: mismo criterio para el canal del chat grupal.
    if (window.chatGrupalRealtimeChannel) {
        window.supabaseClient.removeChannel(window.chatGrupalRealtimeChannel);
        window.chatGrupalRealtimeChannel = null;
    }
    // Punto 33: mismo criterio para el canal de notificaciones.
    if (window.notifRealtimeChannel) {
        window.supabaseClient.removeChannel(window.notifRealtimeChannel);
        window.notifRealtimeChannel = null;
    }
    // E4 (v70): mismo criterio para el canal de saldo en vivo.
    if (window.saldoRealtimeChannel) {
        window.supabaseClient.removeChannel(window.saldoRealtimeChannel);
        window.saldoRealtimeChannel = null;
    }
    // BUGFIX (2026-08-08): estos 2 canales nunca se cerraban al
    // hacer logout (a diferencia de todos los de arriba) - una de
    // las causas del bug "cannot add postgres_changes callbacks...
    // after subscribe()" que obligaba a recargar la página.
    if (window.solicitudesRetiroRealtimeChannel) {
        window.supabaseClient.removeChannel(window.solicitudesRetiroRealtimeChannel);
        window.solicitudesRetiroRealtimeChannel = null;
    }
    if (window.sugerenciasRealtimeChannel) {
        window.supabaseClient.removeChannel(window.sugerenciasRealtimeChannel);
        window.sugerenciasRealtimeChannel = null;
    }
    // A2: apagar también el polling de respaldo, si no queda
    // corriendo de fondo con la sesión ya cerrada.
    if (window.notifPollInterval) {
        clearInterval(window.notifPollInterval);
        window.notifPollInterval = null;
    }
    window.notifPollUsuarioId = null;
    // Punto 36b: cerrar sesión debe funcionar aunque no haya internet
    // (el usuario quiere salir de la app, no debería quedar atrapado
    // adentro) — si signOut() falla por conexión, se limpia todo del
    // lado local igual, para que la próxima apertura pida login de
    // nuevo en vez de reusar una sesión vieja.
    try {
        await window.supabaseClient.auth.signOut();
    } catch (err) {
        console.error('signOut falló (probablemente sin conexión), se limpia la sesión local igual:', err);
    }
    sessionStorage.removeItem('cuevacoin_usuario_actual');
    sessionStorage.removeItem('cuevacoin_temp_user');
    localStorage.removeItem('cuevacoin_perfil_cache');
    localStorage.removeItem('cuevacoin_sesion_inicio');
    (window.showLoginScreen && window.showLoginScreen());
    } finally {
        (window.ocultarCargando && window.ocultarCargando());
    }
}


if (typeof window !== 'undefined') {
    window.logout = logout;
}
