/**
 * CuevaCoin — js/admin/correo-lista.js
 * Lista de solicitudes de cambio de correo pendientes — Oleada 7.
 * Solo render UI; aprobar/rechazar viven en correo-solicitudes.js.
 */

export async function loadAdminSolicitudesCorreo() {
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    if (!client) return;

    const { data: solicitudes, error } = await client
        .from('solicitudes_cambio_correo')
        .select('id, correo_actual, correo_nuevo, motivo, creado_en, usuario_id, perfiles!solicitudes_cambio_correo_usuario_id_fkey(nombre, usuario)')
        .eq('estado', 'pendiente')
        .order('creado_en');
    if (error) {
        console.error(error);
        return;
    }

    const cardsContainer = document.getElementById('admin-solicitudes-correo-cards');
    const vacioMsg = document.getElementById('admin-solicitudes-correo-vacio');
    if (!cardsContainer || !vacioMsg) return;
    cardsContainer.innerHTML = '';

    if (!solicitudes || solicitudes.length === 0) {
        cardsContainer.classList.add('hidden');
        vacioMsg.classList.remove('hidden');
        return;
    }
    cardsContainer.classList.remove('hidden');
    vacioMsg.classList.add('hidden');

    solicitudes.forEach(s => {
        const nombreMostrar = (s.perfiles && (s.perfiles.nombre || s.perfiles.usuario)) || 'N/A';
        const card = document.createElement('div');
        card.className = 'solicitud-card';
        const correoNuevoEsc = String(s.correo_nuevo || '').replace(/'/g, "\\'");
        const nombreEsc = String(nombreMostrar).replace(/'/g, "\\'");
        card.innerHTML = `
                    <div class="solicitud-card-header">
                        <span class="solicitud-card-nombre">${nombreMostrar}</span>
                    </div>
                    <div class="solicitud-card-detalles">
                        ${new Date(s.creado_en).toLocaleString()}<br>
                        De: ${s.correo_actual || '(sin correo)'}<br>
                        A: ${s.correo_nuevo}
                        ${s.motivo ? '<br>Motivo: ' + s.motivo : ''}
                    </div>
                    <div class="solicitud-card-acciones">
                        <button class="btn btn-success" onclick="aprobarCambioCorreo('${s.id}', '${s.usuario_id}', '${correoNuevoEsc}', '${nombreEsc}')">Aprobar</button>
                        <button class="btn btn-danger" onclick="rechazarCambioCorreo('${s.id}', '${s.usuario_id}', '${nombreEsc}')">Rechazar</button>
                    </div>
                `;
        cardsContainer.appendChild(card);
    });
}

if (typeof window !== 'undefined') {
    window.loadAdminSolicitudesCorreo = loadAdminSolicitudesCorreo;
}
