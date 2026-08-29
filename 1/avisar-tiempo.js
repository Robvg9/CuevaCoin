/** CuevaCoin — js/admin/avisar-tiempo.js
 * Fase 5 — Aviso de tiempo de solicitud (notificación, no aprueba retiro).
 */

export async function avisarTiempoSolicitud(usuarioId) {
    if (!window.requiereConexionParaOperar()) return;
    const mensaje = prompt('¿Qué le quieres avisar sobre el tiempo de espera? (ej: "Se procesará en 1 o 2 días")');
    if (!mensaje || !mensaje.trim()) return;

    const mensajeAviso = `Sobre tu solicitud de retiro: ${mensaje.trim()}`;
    const { error } = await window.supabaseClient
        .from('notificaciones')
        .insert({
            usuario_id: usuarioId,
            mensaje: mensajeAviso,
            leida: false,
            tipo_evento: 'retiro_tiempo_avisado',
        });
    if (error) {
        console.error(error);
        window.showToast('No se pudo enviar el aviso', 3000);
        return;
    }

    // Mandar push real (punto 13c-4)
    window.supabaseClient.functions.invoke('enviar-push', {
        body: { usuario_id: usuarioId, mensaje: mensajeAviso, tipo_evento: 'retiro_tiempo_avisado' }
    }).catch((err) => console.error('Error mandando push de aviso de tiempo:', err));

    window.showToast('Aviso enviado al trabajador', 3000);
}

if (typeof window !== 'undefined') {
    window.avisarTiempoSolicitud = avisarTiempoSolicitud;
}
