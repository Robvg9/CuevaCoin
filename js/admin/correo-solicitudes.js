/**
 * CuevaCoin — js/admin/correo-solicitudes.js
 * Aprobar/rechazar cambio de correo — Oleada 6.
 * Gestión de cuenta; no opera saldo/retiros/transferencias.
 */

export async function aprobarCambioCorreo(solicitudId, usuarioId, correoNuevo, nombreUsuario) {
    if (!window.requiereConexionParaOperar()) return;
    const admin = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    const { data: perfilDestino, error: errorPerfilDestino } = await window.supabaseClient
        .from('perfiles').select('es_dependiente').eq('id', usuarioId).maybeSingle();
    if (errorPerfilDestino || perfilDestino?.es_dependiente !== true) {
        window.showToast('Esta cuenta pertenece solo a FORTUNA y no se gestiona desde CuevaCoin.', 3500);
        return;
    }

    // Guardia .eq('estado', 'pendiente') igual que en retiros, para
    // que un doble clic o dos admins a la vez no lo procesen dos veces.
    const { data: solicitudActualizada, error: errorUpdateSolicitud } = await window.supabaseClient
        .from('solicitudes_cambio_correo')
        .update({ estado: 'aprobado', resuelto_por: admin.id, resuelto_en: new Date().toISOString() })
        .eq('id', solicitudId)
        .eq('estado', 'pendiente')
        .select();

    if (errorUpdateSolicitud) {
        console.error(errorUpdateSolicitud);
        window.showToast('No se pudo aprobar el cambio de correo. Intenta de nuevo.', 3000);
        return;
    }
    if (!solicitudActualizada || solicitudActualizada.length === 0) {
        window.showToast('Esta solicitud ya no estaba pendiente — se refrescó la lista.', 3500);
        window.loadAdminSolicitudesCorreo();
        return;
    }

    const { error: errorCorreo } = await window.supabaseClient
        .from('perfiles')
        .update({ correo: correoNuevo })
        .eq('id', usuarioId);
    if (errorCorreo) {
        console.error(errorCorreo);
        window.showToast('¡Atención! Se aprobó la solicitud pero NO se pudo actualizar el correo. Ajústalo manualmente.', 6000);
        window.loadAdminSolicitudesCorreo();
        return;
    }

    const mensajeAprobado = `Tu solicitud de cambio de correo a "${correoNuevo}" fue aprobada.`;
    const { error: errorNotificacion } = await window.supabaseClient
        .from('notificaciones')
        .insert({ usuario_id: usuarioId, mensaje: mensajeAprobado, leida: false, tipo_evento: 'cambio_correo_aprobado' });
    if (errorNotificacion) console.error(errorNotificacion);

    window.supabaseClient.functions.invoke('enviar-push', {
        body: { usuario_id: usuarioId, mensaje: mensajeAprobado, tipo_evento: 'cambio_correo_aprobado' }
    }).catch((err) => console.error('Error mandando push de cambio de correo aprobado:', err));

    const { error: errorAuditoria } = await window.supabaseClient
        .from('auditoria')
        .insert({
            usuario_id: admin.id,
            usuario_nombre: admin.nombre || admin.usuario,
            accion: `Aprobó cambio de correo a "${correoNuevo}" para ${nombreUsuario || 'un usuario'}`
        });
    if (errorAuditoria) console.error(errorAuditoria);

    window.showToast('Cambio de correo aprobado', 3000);
    window.loadAdminSolicitudesCorreo();
    window.loadAdminUsuarios();
}

export async function rechazarCambioCorreo(solicitudId, usuarioId, nombreUsuario) {
    if (!window.requiereConexionParaOperar()) return;
    const admin = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));

    const { error: errorUpdateSolicitud } = await window.supabaseClient
        .from('solicitudes_cambio_correo')
        .update({ estado: 'rechazado', resuelto_por: admin.id, resuelto_en: new Date().toISOString() })
        .eq('id', solicitudId);
    if (errorUpdateSolicitud) {
        console.error(errorUpdateSolicitud);
        window.showToast('No se pudo rechazar la solicitud', 3000);
        return;
    }

    const mensajeRechazado = 'Tu solicitud de cambio de correo fue rechazada.';
    const { error: errorNotificacion } = await window.supabaseClient
        .from('notificaciones')
        .insert({ usuario_id: usuarioId, mensaje: mensajeRechazado, leida: false, tipo_evento: 'cambio_correo_rechazado' });
    if (errorNotificacion) console.error(errorNotificacion);

    window.supabaseClient.functions.invoke('enviar-push', {
        body: { usuario_id: usuarioId, mensaje: mensajeRechazado, tipo_evento: 'cambio_correo_rechazado' }
    }).catch((err) => console.error('Error mandando push de cambio de correo rechazado:', err));

    const { error: errorAuditoria } = await window.supabaseClient
        .from('auditoria')
        .insert({
            usuario_id: admin.id,
            usuario_nombre: admin.nombre || admin.usuario,
            accion: `Rechazó cambio de correo para ${nombreUsuario || 'un usuario'}`
        });
    if (errorAuditoria) console.error(errorAuditoria);

    window.showToast('Cambio de correo rechazado', 3000);
    window.loadAdminSolicitudesCorreo();
}

if (typeof window !== 'undefined') {
    window.aprobarCambioCorreo = aprobarCambioCorreo;
    window.rechazarCambioCorreo = rechazarCambioCorreo;
}
