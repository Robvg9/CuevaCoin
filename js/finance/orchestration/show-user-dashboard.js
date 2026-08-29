/** Fase 3 / Oleada 9 — showUserDashboard */

export function showUserDashboard(usuario) {
    try {
        window.ocultarSplashArranque();
        if (typeof window.ocultarCargando === 'function') window.ocultarCargando();

        // En módulos ES los identificadores libres NO resuelven a window.*
        // (ReferenceError). Usar siempre window. para bridges del monolito.
        if (typeof window.aplicarColorAcento === 'function') {
            window.aplicarColorAcento(usuario.colorAcento || 'rosa');
        }
        if (typeof window.renderColorAcentoSwatches === 'function') {
            window.renderColorAcentoSwatches(usuario.colorAcento || 'rosa');
        }

        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('admin-panel').classList.add('hidden');
        document.getElementById('user-dashboard').classList.remove('hidden');
        document.getElementById('sidebar').classList.remove('hidden');
        document.getElementById('app-topbar').classList.remove('hidden');
        document.getElementById('google-vinculacion-screen').classList.add('hidden');

        document.getElementById('topbar-user').textContent = usuario.nombre || usuario.usuario;
        document.getElementById('topbar-avatar').src = usuario.foto || `https://ui-avatars.com/api/?name=${usuario.usuario}&background=2563EB&color=fff`;
        document.getElementById('auditoria-link').style.display = 'none';
        document.getElementById('usuarios-link').style.display = 'none';
        document.getElementById('solicitudes-link').style.display = 'none';
        document.getElementById('anuncios-link-item').style.display = 'none';
        document.getElementById('estadisticas-link-item').style.display = 'none';
        document.getElementById('historial-link-item').style.display = '';

        document.getElementById('user-inicio').classList.remove('hidden');
        if (typeof window.loadUserInicio === 'function') window.loadUserInicio(usuario);

        if (typeof window.loadUserChat === 'function') window.loadUserChat(usuario.id);
        if (typeof window.loadGrupalChat === 'function') window.loadGrupalChat('user');
        if (typeof window.loadContactosPrivado === 'function') window.loadContactosPrivado();

        if (typeof window.suscribirRealtimeChatUsuario === 'function') window.suscribirRealtimeChatUsuario(usuario.id);
        if (typeof window.revisarNovedadesChatInicial === 'function') window.revisarNovedadesChatInicial('user', usuario.id);
        if (typeof window.verificarAnuncioActivo === 'function') window.verificarAnuncioActivo();
        if (typeof window.verificarNovedadInfoBonos === 'function') window.verificarNovedadInfoBonos(usuario.id);
        if (typeof window.actualizarBadgeNotificaciones === 'function') window.actualizarBadgeNotificaciones(usuario.id);
        if (typeof window.suscribirRealtimeNotificaciones === 'function') window.suscribirRealtimeNotificaciones(usuario.id);
        if (typeof window.suscribirRealtimeSaldo === 'function') window.suscribirRealtimeSaldo(usuario.id);
        if (typeof window.actualizarPuntosRojosMenu === 'function') window.actualizarPuntosRojosMenu();
        if (typeof window.aplicarEstadoCuentaDesactivada === 'function') window.aplicarEstadoCuentaDesactivada(usuario);
        if (typeof window.actualizarBonosDot === 'function') window.actualizarBonosDot(false);
        if (typeof window.suscribirRealtimeSugerencias === 'function') window.suscribirRealtimeSugerencias(false);

        if (typeof window.asegurarUiVersionYActualizar === 'function') window.asegurarUiVersionYActualizar();
        if (typeof window.mostrarVersionApp === 'function') window.mostrarVersionApp();
    } finally {
        if (typeof window.ocultarCargando === 'function') window.ocultarCargando();
        if (typeof window.ocultarSplashArranque === 'function') window.ocultarSplashArranque();
    }
}

if (typeof window !== 'undefined') {
    window.showUserDashboard = showUserDashboard;
}
