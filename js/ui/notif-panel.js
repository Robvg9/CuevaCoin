/**
 * CuevaCoin — js/ui/notif-panel.js
 * Panel de campanita de notificaciones (UI). Oleada 3.
 * No inserta notificaciones de retiro; solo lista y marca leídas.
 */


export const SECCION_POR_TIPO_EVENTO = {
    solicitud_retiro: 'solicitudes',
    solicitud_cambio_correo: 'solicitudes',
    retiro_tiempo_avisado: 'historial',
    retiro_aprobado: 'historial',
    retiro_rechazado: 'historial',
    ajuste_saldo: 'historial',
    pago_admin: 'historial',
    sugerencia: 'bonos',
    mensaje_chat: 'chat',
    cambio_correo_aprobado: 'perfil',
    cambio_correo_rechazado: 'perfil',
    meta_ahorro: 'perfil',
    anuncio: null
};


export function interpretarNotificacionSeccion(mensaje, tipoEvento) {
    if (tipoEvento && tipoEvento in SECCION_POR_TIPO_EVENTO) {
        return SECCION_POR_TIPO_EVENTO[tipoEvento];
    }
    if (!mensaje) return null;
    if (mensaje.includes('META_AHORRO')) return 'perfil';
    if (mensaje.includes('ANUNCIO:')) return null;
    if (mensaje.includes('solicitó un retiro de')) return 'solicitudes';
    if (mensaje.includes('solicitó cambiar su correo a')) return 'solicitudes';
    if (mensaje.includes('Sobre tu solicitud de retiro')) return 'historial';
    if (mensaje.includes('respondió tu sugerencia')) return 'bonos';
    if (mensaje.includes('mandó una sugerencia')) return 'bonos';
    if (mensaje.includes('te escribió:')) return 'chat';
    if (mensaje.includes('ajustó tu saldo')) return 'historial';
    if (mensaje.includes('solicitud de cambio de correo') || mensaje.includes('cambio de correo a')) return 'perfil';
    if (mensaje.includes('solicitud de retiro de $') && (mensaje.includes('aprobada') || mensaje.includes('rechazada'))) return 'historial';
    if (mensaje.includes('Admin te ha enviado $')) return 'historial';
    return null;
}

export async function cargarPanelNotificaciones(usuarioId) {
    const lista = document.getElementById('notif-panel-lista');
    if (!lista) return;
    lista.innerHTML = '<div class="notif-vacio">Cargando...</div>';
    const client = window.supabaseClient;
    if (!client) {
        lista.innerHTML = '<div class="notif-vacio">No se pudieron cargar las notificaciones.</div>';
        return;
    }
    const { data, error } = await client
        .from('notificaciones')
        .select('id, mensaje, leida, creado_en, tipo_evento')
        .eq('usuario_id', usuarioId)
        .order('creado_en', { ascending: false })
        .limit(20);
    if (error) {
        console.error('Error cargando notificaciones:', error);
        lista.innerHTML = '<div class="notif-vacio">No se pudieron cargar las notificaciones.</div>';
        return;
    }
    if (!data || data.length === 0) {
        lista.innerHTML = '<div class="notif-vacio">No tienes notificaciones todavía.</div>';
        return;
    }
    lista.innerHTML = data.map(n => {
        const fecha = new Date(n.creado_en).toLocaleString('es', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const seccion = interpretarNotificacionSeccion(n.mensaje, n.tipo_evento);
        const claseAccionable = seccion ? ' notif-item-accionable' : '';
        const atributoSeccion = seccion ? ` data-seccion="${seccion}"` : '';
        const flecha = seccion ? '<span class="notif-item-flecha">›</span>' : '';
        return `<div class="notif-item ${n.leida ? '' : 'no-leida'}${claseAccionable}"${atributoSeccion}>
                    ${flecha}
                    ${n.mensaje.replace('🎉 META_AHORRO: ', '🎉 ')}
                    <span class="notif-fecha">${fecha}</span>
                </div>`;
    }).join('');
    const idsNoLeidas = data.filter(n => !n.leida).map(n => n.id);
    if (idsNoLeidas.length > 0) {
        client
            .from('notificaciones')
            .update({ leida: true })
            .in('id', idsNoLeidas)
            .then(({ error: errorUpdate }) => {
                if (errorUpdate) console.error('Error marcando notificaciones como leídas:', errorUpdate);
                if (typeof window.actualizarBadgeNotificaciones === 'function') {
                    window.actualizarBadgeNotificaciones(usuarioId);
                }
            });
    }
}

export function toggleNotifPanel() {
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    if (!usuario) return;
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const estabaAbierto = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (!estabaAbierto) {
        cargarPanelNotificaciones(usuario.id);
    }
}

if (typeof window !== 'undefined') {
    window.SECCION_POR_TIPO_EVENTO = SECCION_POR_TIPO_EVENTO;
    window.interpretarNotificacionSeccion = interpretarNotificacionSeccion;
    window.cargarPanelNotificaciones = cargarPanelNotificaciones;
    window.toggleNotifPanel = toggleNotifPanel;
}
