/**
 * CuevaCoin — js/data/notifications.js
 * Badge, preferencias de notificaciones/privacidad y suscripción Realtime
 * de la tabla notificaciones (Fase 2 / Oleada 1).
 * Comportamiento 1:1 con el monolito original (v125).
 *
 * NO incluye: notificaciones de retiro/dedup, push subscription completa,
 * panel UI (toggleNotifPanel / cargarPanelNotificaciones), ni saldo realtime.
 *
 * Depende de:
 *   - window.supabaseClient
 *   - window.showToast, state flags (notifRealtimeChannel, notifPoll*, hayNotifSinLeerGlobal)
 *   - window.actualizarDotMenuUnico, window.reproducirAvisoNotificacion,
 *     window.cargarPanelNotificaciones, window.openModal, window.requiereConexionParaOperar
 *     (siguen en el monolito por ahora)
 */

function _client() {
    if (typeof window === 'undefined' || !window.supabaseClient) {
        throw new Error('supabaseClient no disponible');
    }
    return window.supabaseClient;
}

// ============================================
// BADGE (campanita + punto rojo)
// ============================================
export async function actualizarBadgeNotificaciones(usuarioId) {
    if (!usuarioId) {
        console.warn('[NOTIF-DEBUG] actualizarBadgeNotificaciones llamado sin usuarioId');
        return;
    }

    console.log(`[NOTIF-DEBUG] Actualizando badge para usuario ${usuarioId}`);

    const { count, error } = await _client()
        .from('notificaciones')
        .select('id', { count: 'exact', head: true })
        .eq('usuario_id', usuarioId)
        .eq('leida', false);

    if (error) {
        console.error('[NOTIF-DEBUG] Error revisando notificaciones sin leer:', error);
        console.error('[NOTIF-DEBUG] Detalles:', JSON.stringify(error, null, 2));
        return;
    }

    const hayNuevas = (count || 0) > 0;
    console.log(`[NOTIF-DEBUG] Notificaciones sin leer: ${count}, hayNuevas: ${hayNuevas}`);

    const dotBell = document.getElementById('notif-dot-bell');
    if (dotBell) dotBell.classList.toggle('hidden', !hayNuevas);

    if (typeof window !== 'undefined') {
        window.hayNotifSinLeerGlobal = hayNuevas;
        if (typeof window.actualizarDotMenuUnico === 'function') {
            window.actualizarDotMenuUnico();
        }
    }
}

// ============================================
// REALTIME: INSERT en notificaciones
// ============================================
export function suscribirRealtimeNotificaciones(usuarioId) {
    const client = _client();

    if (typeof window !== 'undefined' && window.notifRealtimeChannel) {
        client.removeChannel(window.notifRealtimeChannel);
        window.notifRealtimeChannel = null;
    }

    const channel = client
        .channel(`notificaciones-${usuarioId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'notificaciones',
            filter: `usuario_id=eq.${usuarioId}`,
        }, (payload) => {
            actualizarBadgeNotificaciones(usuarioId);
            if (payload?.new?.tipo_evento === 'recuperacion_cuenta') {
                try {
                    const actual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
                    if (actual && actual.id === usuarioId && actual.esAdmin) {
                        if (typeof window.showToast === 'function') window.showToast(payload.new.mensaje || '🔐 Nueva solicitud de recuperación de cuenta.', 6000);
                        if (typeof window.loadAdminRecoveryRequests === 'function') window.loadAdminRecoveryRequests();
                    }
                } catch (error) {
                    console.warn('[CuevaCoin] No se pudo actualizar la cola de recuperación en tiempo real:', error);
                }
            }
            if (typeof window !== 'undefined' && typeof window.reproducirAvisoNotificacion === 'function') {
                window.reproducirAvisoNotificacion();
            }
            const panel = document.getElementById('notif-panel');
            if (panel && !panel.classList.contains('hidden') &&
                typeof window !== 'undefined' && typeof window.cargarPanelNotificaciones === 'function') {
                window.cargarPanelNotificaciones(usuarioId);
            }
            if (payload?.new?.mensaje && payload.new.mensaje.startsWith('🎉 META_AHORRO:')) {
                if (typeof window !== 'undefined' && typeof window.openModal === 'function') {
                    window.openModal('felicitacion-meta-ahorro-modal');
                }
            }
        })
        .subscribe((status, err) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                console.error('Realtime notificaciones no se pudo suscribir:', status, err);
                setTimeout(() => {
                    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
                    if (usuarioActual && usuarioActual.id === usuarioId) {
                        suscribirRealtimeNotificaciones(usuarioId);
                    }
                }, 4000);
            }
        });

    if (typeof window !== 'undefined') {
        window.notifRealtimeChannel = channel;
        window.notifPollUsuarioId = usuarioId;
        if (window.notifPollInterval) clearInterval(window.notifPollInterval);
        window.notifPollInterval = setInterval(() => {
            if (document.visibilityState === 'visible' && window.notifPollUsuarioId) {
                actualizarBadgeNotificaciones(window.notifPollUsuarioId);
            }
        }, 45000);
    }
}

// ============================================
// PREFERENCIAS DE NOTIFICACIONES
// ============================================
export async function loadPreferenciasNotificaciones(usuarioActual) {
    const toggles = document.querySelectorAll('.js-pref-notif-toggle');
    const { data, error } = await _client()
        .from('perfiles')
        .select('preferencias_notificaciones')
        .eq('id', usuarioActual.id)
        .single();
    if (error) {
        console.error('Error cargando preferencias de notificaciones:', error);
        return;
    }
    const prefs = data?.preferencias_notificaciones || {};
    toggles.forEach(toggle => {
        const evento = toggle.dataset.evento;
        toggle.checked = prefs[evento] !== false;
        toggle.onchange = () => guardarPreferenciaNotificacion(usuarioActual.id, evento, toggle.checked, toggle);
    });
}

export async function guardarPreferenciaNotificacion(usuarioId, evento, activado, toggleEl) {
    const requiere = (typeof window !== 'undefined' && window.requiereConexionParaOperar)
        ? window.requiereConexionParaOperar
        : () => true;
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};

    if (!requiere()) {
        if (toggleEl) toggleEl.checked = !activado;
        return;
    }
    const { data, error: errorLectura } = await _client()
        .from('perfiles')
        .select('preferencias_notificaciones')
        .eq('id', usuarioId)
        .single();
    if (errorLectura) {
        console.error('Error leyendo preferencias antes de guardar:', errorLectura);
        toast('No se pudo guardar el cambio', 3000);
        return;
    }
    const prefsActuales = data?.preferencias_notificaciones || {};
    const prefsNuevas = { ...prefsActuales, [evento]: activado };
    const { error: errorGuardado } = await _client()
        .from('perfiles')
        .update({ preferencias_notificaciones: prefsNuevas })
        .eq('id', usuarioId);
    if (errorGuardado) {
        console.error('Error guardando preferencia de notificación:', errorGuardado);
        toast('No se pudo guardar el cambio', 3000);
        return;
    }
    toast(activado ? 'Notificación activada' : 'Notificación desactivada', 2000);
}

// ============================================
// PREFERENCIAS DE PRIVACIDAD (mismo patrón jsonb)
// ============================================
export async function loadPreferenciasPrivacidad(usuarioActual) {
    const toggles = document.querySelectorAll('.js-pref-privacidad-toggle');
    const { data, error } = await _client()
        .from('perfiles')
        .select('preferencias_privacidad')
        .eq('id', usuarioActual.id)
        .single();
    if (error) {
        console.error('Error cargando preferencias de privacidad:', error);
        return;
    }
    const prefs = data?.preferencias_privacidad || {};
    toggles.forEach(toggle => {
        const campo = toggle.dataset.campo;
        toggle.checked = prefs[campo] !== false;
        toggle.onchange = () => guardarPreferenciaPrivacidad(usuarioActual.id, campo, toggle.checked, toggle);
    });
}

export async function guardarPreferenciaPrivacidad(usuarioId, campo, visible, toggleEl) {
    const requiere = (typeof window !== 'undefined' && window.requiereConexionParaOperar)
        ? window.requiereConexionParaOperar
        : () => true;
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};

    if (!requiere()) {
        if (toggleEl) toggleEl.checked = !visible;
        return;
    }
    const { data, error: errorLectura } = await _client()
        .from('perfiles')
        .select('preferencias_privacidad')
        .eq('id', usuarioId)
        .single();
    if (errorLectura) {
        console.error('Error leyendo preferencias de privacidad antes de guardar:', errorLectura);
        toast('No se pudo guardar el cambio', 3000);
        return;
    }
    const prefsActuales = data?.preferencias_privacidad || {};
    const prefsNuevas = { ...prefsActuales, [campo]: visible };
    const { error: errorGuardado } = await _client()
        .from('perfiles')
        .update({ preferencias_privacidad: prefsNuevas })
        .eq('id', usuarioId);
    if (errorGuardado) {
        console.error('Error guardando preferencia de privacidad:', errorGuardado);
        toast('No se pudo guardar el cambio', 3000);
        return;
    }
    toast(visible ? 'Ahora tus compañeras pueden ver ese dato' : 'Ese dato quedó oculto para tus compañeras', 2500);
}

// ============================================
// Compatibilidad con el monolito
// ============================================
if (typeof window !== 'undefined') {
    window.actualizarBadgeNotificaciones = actualizarBadgeNotificaciones;
    window.suscribirRealtimeNotificaciones = suscribirRealtimeNotificaciones;
    window.loadPreferenciasNotificaciones = loadPreferenciasNotificaciones;
    window.guardarPreferenciaNotificacion = guardarPreferenciaNotificacion;
    window.loadPreferenciasPrivacidad = loadPreferenciasPrivacidad;
    window.guardarPreferenciaPrivacidad = guardarPreferenciaPrivacidad;
}
