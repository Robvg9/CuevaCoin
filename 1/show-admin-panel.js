/** Fase 3 / Oleada 9 — showAdminPanel */

export function showAdminPanel(admin) {
    window.ocultarSplashArranque();
    aplicarColorAcento(admin.colorAcento || 'rosa');
    renderColorAcentoSwatches(admin.colorAcento || 'rosa');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('user-dashboard').classList.add('hidden');
    document.getElementById('admin-panel').classList.remove('hidden');
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('app-topbar').classList.remove('hidden');
    // FIX (F-GMAIL, v91): mismo fix que en window.showLoginScreen/
    // window.showUserDashboard - por las dudas de que quedara visible de
    // un estado anterior.
    document.getElementById('google-vinculacion-screen').classList.add('hidden');

    document.getElementById('topbar-user').textContent = admin.nombre || admin.usuario;
    document.getElementById('topbar-avatar').src = admin.foto || `https://ui-avatars.com/api/?name=${admin.usuario}&background=0F172A&color=fff`;
    document.getElementById('auditoria-link').style.display = '';
    document.getElementById('usuarios-link').style.display = '';
    document.getElementById('solicitudes-link').style.display = '';
    // E6 (2026-08-08): "Anuncios" es una sección exclusiva del admin.
    document.getElementById('anuncios-link-item').style.display = '';
    // F6 (2026-08-08): "Estadísticas" también es exclusiva del admin.
    document.getElementById('estadisticas-link-item').style.display = '';
    // FIX (v74): el admin ya tiene "Auditoría" completa - ocultar el
    // "Historial" duplicado que antes redirigía a la misma pantalla.
    document.getElementById('historial-link-item').style.display = 'none';
    // FIX (2026-08-05, v45): se eliminó la línea que ponía
    // textContent en "chat-sidebar-label" porque ese id ya no
    // existe en el HTML desde el rediseño v42 (el sidebar quedó
    // con el texto "Chat" fijo). Esa línea rota tiraba
    // "Cannot set properties of null" y cortaba toda la función
    // a la mitad - esta era la verdadera causa de la pantalla
    // negra después del login (nunca se llegaba a mostrar
    // admin-inicio).

    // Cargar secciones por defecto
    window.loadSection('inicio');
    window.loadAdminStats();

    // Cargar usuarios en el select de chat
    window.loadChatDestinatarios();

    // B5 (v62): precargar el chat grupal en segundo plano apenas
    // entra el admin, para que al abrir la pestaña "Grupal" los
    // mensajes ya estén (y el canal Realtime ya esté suscrito) en
    // vez de recién empezar a pedirlos al hacer clic. El chat de
    // "Soporte" (1:1 con cada trabajadora) no tiene una conversación
    // por defecto que precargar - ya se precarga la LISTA de
    // contactos arriba (window.loadChatDestinatarios), que es lo único que
    // se puede adelantar sin saber todavía con quién va a chatear.
    window.loadGrupalChat('admin');

    // Revisar estado de notificaciones push (Configuración > Notificaciones
    // es compartida entre admin y trabajadoras).
    window.actualizarEstadoBotonPush();
    // v107: resincronización silenciosa (ver comentario en la función).
    window.sincronizarSuscripcionPush(admin.id);

    // Punto 7f: chat en vivo sin recargar.
    window.suscribirRealtimeChatAdmin(admin.id);

    // Tanda v77: burbujitas de mensaje sin leer por chat - revisa
    // si ya había algo sin ver ANTES de que llegue nada nuevo por
    // Realtime (ej. mensajes que llegaron con la app cerrada).
    window.revisarNovedadesChatInicial('admin', admin.id);

    // Punto 1 (2026-08-07): cartel de anuncio al iniciar sesión, si
    // hay uno vigente y todavía no se vio en esta sesión.
    window.verificarAnuncioActivo();

    // Punto 33: campanita/punto rojo de notificaciones + Realtime
    // para que se actualice en vivo sin recargar.
    actualizarBadgeNotificaciones(admin.id);
    window.suscribirRealtimeNotificaciones(admin.id);

    // Punto 40: puntos rojos de novedades del menú.
    actualizarPuntosRojosMenu();

    // B6 (2026-08-06): Realtime sobre solicitudes_retiro para que el
    // punto de aviso junto a "Solicitudes de Retiro" (y el contador
    // de la tarjeta de Inicio) se actualicen al instante cuando llega
    // una solicitud nueva o cambia de estado, sin depender de que el
    // admin recargue la página.
    window.suscribirRealtimeSolicitudesRetiro();

    // E2 (v62): punto de aviso en "Bonos" cuando hay sugerencias sin
    // leer del lado del admin, con Realtime para que se actualice
    // al instante (mismo patrón que solicitudes-retiro-dot de B6).
    window.actualizarBonosDot(true);
    window.suscribirRealtimeSugerencias(true);
}

if (typeof window !== 'undefined') {
    window.showAdminPanel = showAdminPanel;
}
