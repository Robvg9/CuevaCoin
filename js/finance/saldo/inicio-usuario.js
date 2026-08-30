/** Fase 3 / Oleada 3 — loadUserInicio */

export async function loadUserInicio(usuario) {
    document.getElementById('user-name').textContent = usuario.nombre || usuario.usuario;
    window.actualizarFrasePersonalInicio(usuario.frasePersonal);
    window.actualizarMetaAhorroInicio(usuario);
    window.actualizarMascotaSaldo(usuario);
    const correoSpan = document.getElementById('user-correo');
    correoSpan.textContent = usuario.correo || 'Sin correo registrado';
    correoSpan.dataset.correo = usuario.correo || '';
    document.getElementById('user-saldo').textContent = usuario.saldo.toFixed(2);
    document.getElementById('perfil-avatar').src = usuario.foto || `https://ui-avatars.com/api/?name=${usuario.usuario}&background=2563EB&color=fff`;
    document.getElementById('perfil-nombre').textContent = usuario.nombre || usuario.usuario;
    document.getElementById('perfil-usuario').textContent = usuario.usuario;
    document.getElementById('perfil-saldo').textContent = usuario.saldo.toFixed(2);
    document.getElementById('perfil-ultima-conexion').textContent = window.formatearUltimaVez(usuario.ultimaConexion);
    window.actualizarEstadoPerfil(usuario);
    loadPreferenciasPrivacidad(usuario);

    // Al entrar, si el perfil está incompleto, avisarle de una vez con
    // el modal (punto 12f) en vez de dejar que lo descubra solo.
    if (!usuario.esAdmin && !usuario.perfilCompleto) {
        window.openModal('perfil-incompleto-modal');
    }

    // Actualizar última conexión (columna real en perfiles)
    const { error: errorUltimaConexion } = await window.supabaseClient
        .from('perfiles')
        .update({ ultima_conexion: new Date().toISOString() })
        .eq('id', usuario.id);
    if (errorUltimaConexion) console.error(errorUltimaConexion);

    // Notificaciones ahora se cargan solo al abrir la campanita
    // (ver toggleNotifPanel/cargarPanelNotificaciones). La llamada
    // a loadUserNotificaciones() que estaba acá apuntaba a un
    // contenedor ("user-notificaciones") que ya no existe en el
    // HTML - quedó huérfana de antes del rediseño v40 y tiraba un
    // error de consola en cada login. Eliminada en v45.

    // Revisar si este dispositivo ya tiene notificaciones push activadas
    // (punto 13a del roadmap) para mostrar el botón correcto.
    window.actualizarEstadoBotonPush();
    // v107: resincronización silenciosa (ver comentario en la función).
    window.sincronizarSuscripcionPush(usuario.id);

    // Retiro pendiente (reservado): el saldo ya se descontó al solicitar;
    // acá solo se muestra cuánto sigue esperando aprobación del admin.
    if (typeof window.actualizarRetiroPendienteUI === 'function') {
        window.actualizarRetiroPendienteUI(usuario.id);
    }
}

if (typeof window !== 'undefined') {
    window.loadUserInicio = loadUserInicio;
}
