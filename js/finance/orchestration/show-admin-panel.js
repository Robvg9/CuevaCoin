/** Fase 3 / Oleada 9 — showAdminPanel */

export function showAdminPanel(admin) {
    try {
        // Preserve the current section when the PWA resumes from background.
        // Reset private drafts only when a different admin account takes over.
        const ownerKey = 'cuevacoin_fortuna_owner_id';
        const previousOwnerId = localStorage.getItem(ownerKey);
        const currentOwnerId = String(admin.id || admin.usuario || '');
        if (previousOwnerId && currentOwnerId && previousOwnerId !== currentOwnerId) {
            if (typeof window.resetFortunaPreviewDrafts === 'function') window.resetFortunaPreviewDrafts();
            localStorage.removeItem('cuevacoin_admin_last_section');
        }
        if (currentOwnerId) localStorage.setItem(ownerKey, currentOwnerId);
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
        // Restaurar los contenedores <li> también al cambiar de rol en la sesión.
        ['usuarios-link', 'solicitudes-link', 'historial-general-link'].forEach(id => {
            const link = document.getElementById(id);
            if (link) {
                link.style.display = '';
                const item = link.closest('li');
                if (item) item.style.display = '';
            }
        });
        const recoveryItem = document.getElementById('recuperacion-link-item');
        if (recoveryItem) recoveryItem.style.display = '';
        document.getElementById('anuncios-link-item').style.display = '';
        document.getElementById('estadisticas-link-item').style.display = '';
        document.getElementById('historial-link-item').style.display = 'none';
        const fortunaItem = document.getElementById('fortuna-link-item');
        if (fortunaItem) fortunaItem.style.display = '';

        const savedSection = localStorage.getItem('cuevacoin_admin_last_section');
        const allowedSections = new Set(['inicio', 'usuarios', 'solicitudes', 'recuperacion', 'historial-general', 'chat', 'bonos', 'anuncios', 'estadisticas', 'fortuna', 'perfil', 'config-cambio-contrasena', 'config-modo-oscuro', 'config-notificaciones', 'como-usar']);
        const resumeSection = allowedSections.has(savedSection) ? savedSection : 'inicio';
        if (typeof window.loadSection === 'function') window.loadSection(resumeSection);
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
