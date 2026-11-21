/** Fase 3 / Oleada 5 — Aprobar/rechazar/resolver retiros */

export async function resolverSolicitudRetiro(solicitudId, accion) {
    const { data, error } = await window.supabaseClient.rpc('admin_resolver_retiro', {
        p_solicitud_id: solicitudId,
        p_accion: accion
    });
    if (error) {
        console.error(error);
        if (error.message && /administrador activo|admin.*activo/i.test(error.message)) {
            window.showToast('Tu cuenta administrativa no está activa. No se procesó el retiro.', 4000);
        } else if (error.message && error.message.includes('ya_no_pendiente')) {
            window.showToast('Esta solicitud ya no estaba pendiente — se refrescó la lista.', 3500);
        } else {
            window.showToast(`No se pudo ${accion === 'aprobar' ? 'aprobar' : 'rechazar'} la solicitud. Intenta de nuevo.`, 3000);
        }
        window.loadAdminSolicitudes();
        window.loadAdminStats();
        return null;
    }
    return Array.isArray(data) ? data[0] : data;
}

export async function aprobarSolicitud(solicitudId, usuarioId, cantidad) {
    if (!window.requiereConexionParaOperar()) return;
    const resultado = await window.resolverSolicitudRetiro(solicitudId, 'aprobar');
    if (!resultado) return;

    const mensajeRetiroAprobado = `Tu solicitud de retiro de $${Number(cantidad).toFixed(2)} ha sido aprobada.`;
    window.supabaseClient.functions.invoke('enviar-push', {
        body: { usuario_id: usuarioId, mensaje: mensajeRetiroAprobado, tipo_evento: 'retiro_aprobado' }
    }).catch((err) => console.error('Error mandando push de retiro aprobado:', err));

    window.showToast('Solicitud aprobada correctamente', 3000);
    window.loadAdminSolicitudes();
    window.loadAdminUsuarios();
    window.loadAdminStats();
}

export async function rechazarSolicitud(solicitudId, usuarioId, cantidad, nombreUsuario) {
    if (!window.requiereConexionParaOperar()) return;
    const resultado = await window.resolverSolicitudRetiro(solicitudId, 'rechazar');
    if (!resultado) return;

    const mensajeRetiroRechazado = `Tu solicitud de retiro de $${Number(cantidad).toFixed(2)} ha sido rechazada. El monto vuelve a tu saldo disponible.`;
    window.supabaseClient.functions.invoke('enviar-push', {
        body: { usuario_id: usuarioId, mensaje: mensajeRetiroRechazado, tipo_evento: 'retiro_rechazado' }
    }).catch((err) => console.error('Error mandando push de retiro rechazado:', err));

    window.showToast('Solicitud rechazada', 3000);
    window.loadAdminSolicitudes();
    window.loadAdminUsuarios();
    window.loadAdminStats();
}

if (typeof window !== 'undefined') {
    window.resolverSolicitudRetiro = resolverSolicitudRetiro;
    window.aprobarSolicitud = aprobarSolicitud;
    window.rechazarSolicitud = rechazarSolicitud;
}
