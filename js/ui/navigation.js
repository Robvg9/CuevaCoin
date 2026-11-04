/**
 * CuevaCoin — js/ui/navigation.js
 * Navegación entre secciones (Fase 3 / Oleada 2).
 * Comportamiento 1:1 con legacy-app.js.
 * Delega cargas de datos (loadUser*, loadAdmin*) al monolito vía window.
 */

function _closeSidebar() {
    if (typeof window !== 'undefined' && typeof window.closeSidebar === 'function') {
        window.closeSidebar();
    }
}

function _showToast(msg, ms) {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(msg, ms);
    }
}

function _call(name, ...args) {
    if (typeof window !== 'undefined' && typeof window[name] === 'function') {
        return window[name](...args);
    }
}

export function actualizarConfigTabsBar(section) {
    const barra = document.getElementById('config-tabs-bar');
    if (!barra) return;
    const esSeccionDeConfig = ['config-cambio-contrasena', 'config-modo-oscuro', 'config-notificaciones', 'como-usar'].includes(section);
    barra.classList.toggle('hidden', !esSeccionDeConfig);
    barra.querySelectorAll('.config-tab[data-tab]').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === section);
    });
}

export function mostrarConAnimacion(el) {
    if (!el) {
        console.error('mostrarConAnimacion: elemento no encontrado, se aborta sin romper la navegación');
        _showToast('No se pudo cargar esa sección. Volviendo a Inicio.', 3000);
        loadSection('inicio');
        return;
    }
    el.classList.remove('hidden');
    el.classList.remove('section-entrando');
    void el.offsetWidth;
    el.classList.add('section-entrando');
}

export function loadSection(section) {
    _closeSidebar();

    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    const isAdmin = usuarioActual && usuarioActual.esAdmin;

    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));

    const seccionesCompartidas = ['perfil', 'config-cambio-contrasena', 'config-modo-oscuro', 'config-notificaciones', 'como-usar'];
    if (seccionesCompartidas.includes(section)) {
        mostrarConAnimacion(document.getElementById(`shared-${section}`));
        actualizarConfigTabsBar(section);
        if (section === 'perfil') {
            _call('loadUserPerfil', usuarioActual);
        } else if (section === 'config-notificaciones') {
            _call('loadPreferenciasNotificaciones', usuarioActual);
        } else if (section === 'como-usar') {
            document.querySelectorAll('.js-como-usar-admin').forEach(el => el.classList.toggle('hidden', !isAdmin));
            _call('marcarNovedadVista', 'como-usar-2026-08-03');
        }
        return;
    }
    actualizarConfigTabsBar(section);

    if (isAdmin) {
        const adminPanel = document.getElementById('admin-panel');
        if (adminPanel) adminPanel.classList.remove('hidden');

        if (section === 'config') {
            loadSection('config-cambio-contrasena');
            return;
        }
        if (section === 'historial') {
            loadSection('auditoria');
            return;
        }

        const adminId =
            section === 'usuarios' ? 'admin-usuarios-seccion'
            : section === 'solicitudes' ? 'admin-solicitudes-seccion'
            : `admin-${section}`;
        mostrarConAnimacion(document.getElementById(adminId));

        if (section === 'inicio') {
            _call('loadAdminStats');
        } else if (section === 'usuarios') {
            _call('loadAdminUsuarios');
        } else if (section === 'solicitudes') {
            _call('loadAdminSolicitudes');
            _call('loadAdminSolicitudesCorreo');
        } else if (section === 'recuperacion') {
            _call('loadAdminRecoveryRequests');
        } else if (section === 'auditoria') {
            _call('cargarDatalistUsuariosAuditoria');
            _call('loadAdminAuditoria');
        } else if (section === 'historial-general') {
            _call('cargarHistorialGeneral');
        } else if (section === 'chat') {
            _call('loadAdminChat');
            _call('marcarNovedadVista', 'chat-grupal-privado-2026-08-03');
            _call('marcarChatTabComoVisto', 'admin', 'soporte');
        } else if (section === 'bonos') {
            _call('loadAdminSugerencias');
            _call('loadContenidoBonosAdminForm');
        } else if (section === 'anuncios') {
            _call('loadAnuncioAdminForm');
        } else if (section === 'estadisticas') {
            _call('loadEstadisticasAdmin');
        }
    } else {
        const userDash = document.getElementById('user-dashboard');
        if (userDash) userDash.classList.remove('hidden');

        if (section === 'config') {
            loadSection('config-cambio-contrasena');
            return;
        }

        mostrarConAnimacion(document.getElementById(`user-${section}`));

        if (section === 'inicio') {
            _call('loadUserInicio', usuarioActual);
        } else if (section === 'historial') {
            _call('loadUserHistorial', usuarioActual && usuarioActual.id);
        } else if (section === 'bonos') {
            _call('loadUserSugerencias', usuarioActual && usuarioActual.id);
            _call('loadUserBonosInfo');
            _call('marcarInfoBonosVista', usuarioActual && usuarioActual.id);
        } else if (section === 'chat') {
            _call('loadUserChat', usuarioActual && usuarioActual.id);
            _call('marcarNovedadVista', 'chat-grupal-privado-2026-08-03');
            _call('marcarChatTabComoVisto', 'user', 'soporte');
        }
    }
}

if (typeof window !== 'undefined') {
    window.actualizarConfigTabsBar = actualizarConfigTabsBar;
    window.mostrarConAnimacion = mostrarConAnimacion;
    window.loadSection = loadSection;
}
