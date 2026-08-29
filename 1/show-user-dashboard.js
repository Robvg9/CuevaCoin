/** Fase 3 / Oleada 9 — showUserDashboard */

export function showUserDashboard(usuario) {
    window.ocultarSplashArranque();
    aplicarColorAcento(usuario.colorAcento || 'rosa');
    renderColorAcentoSwatches(usuario.colorAcento || 'rosa');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('admin-panel').classList.add('hidden');
    document.getElementById('user-dashboard').classList.remove('hidden');
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('app-topbar').classList.remove('hidden');
    // FIX (F-GMAIL, v91): mismo fix que en window.showLoginScreen/
    // window.showAdminPanel - por las dudas de que quedara visible de un
    // estado anterior.
    document.getElementById('google-vinculacion-screen').classList.add('hidden');

    document.getElementById('topbar-user').textContent = usuario.nombre || usuario.usuario;
    document.getElementById('topbar-avatar').src = usuario.foto || `https://ui-avatars.com/api/?name=${usuario.usuario}&background=2563EB&color=fff`;
    document.getElementById('auditoria-link').style.display = 'none';
    document.getElementById('usuarios-link').style.display = 'none';
    document.getElementById('solicitudes-link').style.display = 'none';
    // E6 (2026-08-08): la trabajadora no gestiona anuncios, solo ve
    // el cartel obligatorio (window.verificarAnuncioActivo más abajo).
    document.getElementById('anuncios-link-item').style.display = 'none';
    // F6 (2026-08-08): tampoco ve el panel de Estadísticas.
    document.getElementById('estadisticas-link-item').style.display = 'none';
    // FIX (v74): para el trabajador "Historial" sí es su pantalla
    // real (no duplica nada), se asegura visible por si quedó
    // oculto de una sesión de admin anterior en el mismo dispositivo.
    document.getElementById('historial-link-item').style.display = '';
    // FIX (2026-08-05, v45): misma corrección que en window.showAdminPanel -
    // "chat-sidebar-label" no existe en el HTML, esta línea rota
    // cortaba la función antes de llegar a mostrar user-inicio.

    // Cargar sección de inicio por defecto
    document.getElementById('user-inicio').classList.remove('hidden');
    window.loadUserInicio(usuario);

    // B5 (v62): precargar los 3 chats en segundo plano apenas entra
    // la trabajadora, para que al tocar "Chat" ya estén listos en
    // vez de recién empezar a pedirlos - Soporte (conversación fija
    // con el admin) y Grupal se precargan completos (mensajes +
    // canal Realtime ya suscrito); Privado precarga la LISTA de
    // compañeras disponibles (la conversación puntual se sigue
    // pidiendo recién al elegir una persona, igual que le pasa al
    // admin con Soporte - no hay forma de adelantar eso sin saber
    // todavía con quién va a chatear).
    window.loadUserChat(usuario.id);
    window.loadGrupalChat('user');
    window.loadContactosPrivado();

    // Punto 7f: chat en vivo sin recargar.
    window.suscribirRealtimeChatUsuario(usuario.id);

    // Tanda v77: burbujitas de mensaje sin leer por chat - revisa
    // si ya había algo sin ver ANTES de que llegue nada nuevo por
    // Realtime (ej. mensajes que llegaron con la app cerrada).
    window.revisarNovedadesChatInicial('user', usuario.id);

    // Punto 1 (2026-08-07): cartel de anuncio al iniciar sesión, si
    // hay uno vigente y todavía no se vio en esta sesión.
    window.verificarAnuncioActivo();

    // Punto 2 (2026-08-07): burbuja de "próximos bonos" con
    // contenido nuevo sin ver.
    window.verificarNovedadInfoBonos(usuario.id);

    // Punto 33: campanita/punto rojo de notificaciones + Realtime
    // para que se actualice en vivo sin recargar.
    actualizarBadgeNotificaciones(usuario.id);
    window.suscribirRealtimeNotificaciones(usuario.id);

    // E4 (v70): saldo en vivo si un admin paga/ajusta desde otro
    // dispositivo mientras esta sesión sigue abierta.
    window.suscribirRealtimeSaldo(usuario.id);

    // Punto 40: puntos rojos de novedades del menú.
    actualizarPuntosRojosMenu();

    // F8 (2026-08-07): aviso de cuenta desactivada + modo solo
    // lectura. Se llama al final porque necesita que el resto de
    // showUserDashboard ya haya terminado de armar la pantalla - el
    // modal se abre encima de lo que ya está listo.
    window.aplicarEstadoCuentaDesactivada(usuario);

    // E2 (v62): punto de aviso en "Bonos" cuando el admin respondió
    // una sugerencia que la trabajadora todavía no vio, con
    // Realtime para que se actualice al instante.
    window.actualizarBonosDot(false);
    window.suscribirRealtimeSugerencias(false);
}

if (typeof window !== 'undefined') {
    window.showUserDashboard = showUserDashboard;
}
