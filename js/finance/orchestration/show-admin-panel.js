/** Fase 3 / Oleada 9 — showAdminPanel */

export function showAdminPanel(admin) {
    try {
        window.ocultarSplashArranque();
        if (typeof window.ocultarCargando === 'function') window.ocultarCargando();

        if (typeof window.aplicarColorAcento === 'function') {
            window.aplicarColorAcento(admin.colorAcento || 'rosa');
        }
        if (typeof window.renderColorAcentoSwatches === 'function') {
            window.renderColorAcentoSwatches(admin.colorAcento || 'rosa');
        }

        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('user-dashboard').classList.add('hidden');
        document.getElementById('admin-panel').classList.remove('hidden');
        document.getElementById('sidebar').classList.remove('hidden');
        document.getElementById('app-topbar').classList.remove('hidden');
        document.getElementById('google-vinculacion-screen').classList.add('hidden');

        document.getElementById('topbar-user').textContent = admin.nombre || admin.usuario;
        document.getElementById('topbar-avatar').src = admin.foto || `https://ui-avatars.com/api/?name=${admin.usuario}&background=0F172A&color=fff`;
        document.getElementById('auditoria-link').style.display = '';
        document.getElementById('usuarios-link').style.display = '';
        document.getElementById('solicitudes-link').style.display = '';
        document.getElementById('recuperacion-link-item').style.display = '';
        document.getElementById('anuncios-link-item').style.display = '';
        document.getElementById('estadisticas-link-item').style.display = '';
        document.getElementById('historial-link-item').style.display = 'none';

        if (typeof window.loadSection === 'function') window.loadSection('inicio');
        if (typeof window.loadAdminStats === 'function') window.loadAdminStats();
        if (typeof window.loadChatDestinatarios === 'function') window.loadChatDestinatarios();
        if (typeof window.loadGrupalChat === 'function') window.loadGrupalChat('admin');
        if (typeof window.actualizarEstadoBotonPush === 'function') window.actualizarEstadoBotonPush();
        if (typeof window.sincronizarSuscripcionPush === 'function') window.sincronizarSuscripcionPush(admin.id);
        if (typeof window.suscribirRealtimeChatAdmin === 'function') window.suscribirRealtimeChatAdmin(admin.id);
        if (typeof window.revisarNovedadesChatInicial === 'function') window.revisarNovedadesChatInicial('admin', admin.id);
        if (typeof window.verificarAnuncioActivo === 'function') window.verificarAnuncioActivo();
        if (typeof window.actualizarBadgeNotificaciones === 'function') window.actualizarBadgeNotificaciones(admin.id);
        if (typeof window.suscribirRealtimeNotificaciones === 'function') window.suscribirRealtimeNotificaciones(admin.id);
        if (typeof window.loadAdminRecoveryRequests === 'function') window.loadAdminRecoveryRequests();
        if (typeof window.actualizarPuntosRojosMenu === 'function') window.actualizarPuntosRojosMenu();
        if (typeof window.suscribirRealtimeSolicitudesRetiro === 'function') window.suscribirRealtimeSolicitudesRetiro();
        if (typeof window.actualizarBonosDot === 'function') window.actualizarBonosDot(true);
        if (typeof window.suscribirRealtimeSugerencias === 'function') window.suscribirRealtimeSugerencias(true);

        if (typeof window.asegurarUiVersionYActualizar === 'function') window.asegurarUiVersionYActualizar();
        if (typeof window.mostrarVersionApp === 'function') window.mostrarVersionApp();
    } finally {
        if (typeof window.ocultarCargando === 'function') window.ocultarCargando();
        if (typeof window.ocultarSplashArranque === 'function') window.ocultarSplashArranque();
    }
}

if (typeof window !== 'undefined') {
    window.showAdminPanel = showAdminPanel;
}
