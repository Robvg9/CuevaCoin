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
    if (tipoEvento && Object.prototype.hasOwnProperty.call(SECCION_POR_TIPO_EVENTO, tipoEvento)) {
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

function mostrarEstadoNotificaciones(lista, mensaje) {
    const estado = document.createElement('div');
    estado.className = 'notif-vacio';
    estado.textContent = mensaje;
    lista.replaceChildren(estado);
}

export async function cargarPanelNotificaciones(usuarioId) {
    const lista = document.getElementById('notif-panel-lista');
    if (!lista) return;
    mostrarEstadoNotificaciones(lista, 'Cargando...');
    const client = window.supabaseClient;
    if (!client) {
        mostrarEstadoNotificaciones(lista, 'No se pudieron cargar las notificaciones.');
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
        mostrarEstadoNotificaciones(lista, 'No se pudieron cargar las notificaciones.');
        return;
    }
    if (!data || data.length === 0) {
        mostrarEstadoNotificaciones(lista, 'No tienes notificaciones todavía.');
        return;
    }

    const fragment = document.createDocumentFragment();
    data.forEach(n => {
        const fecha = new Date(n.creado_en).toLocaleString('es', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const seccion = interpretarNotificacionSeccion(String(n.mensaje || ''), n.tipo_evento);
        const item = document.createElement('div');
        item.className = 'notif-item' + (n.leida ? '' : ' no-leida');
        if (seccion) {
            item.classList.add('notif-item-accionable');
            item.dataset.seccion = seccion;
            const arrow = document.createElement('span');
            arrow.className = 'notif-item-flecha';
            arrow.textContent = '›';
            item.appendChild(arrow);
        }

        const message = document.createElement('span');
        message.textContent = String(n.mensaje || '').replace('🎉 META_AHORRO: ', '🎉 ');
        const date = document.createElement('span');
        date.className = 'notif-fecha';
        date.textContent = fecha;
        item.appendChild(message);
        item.appendChild(date);
        fragment.appendChild(item);
    });
    lista.replaceChildren(fragment);

    // Abrir la campanita representa revisar las notificaciones pendientes del usuario.
    // No limitar el marcado a las 20 tarjetas visibles: eso dejaba un badge perpetuo
    // cuando existían notificaciones sin leer más antiguas que la página mostrada.
    const { error: errorUpdate } = await client
        .from('notificaciones')
        .update({ leida: true })
        .eq('usuario_id', usuarioId)
        .eq('leida', false);

    if (errorUpdate) {
        console.error('Error marcando notificaciones pendientes como leídas:', errorUpdate);
    } else if (typeof window.actualizarBadgeNotificaciones === 'function') {
        await window.actualizarBadgeNotificaciones(usuarioId);
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
