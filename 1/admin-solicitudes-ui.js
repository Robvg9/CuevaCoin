/** Fase 3 / Oleada 5 — loadAdminSolicitudes (UI lista) */

export async function loadAdminSolicitudes() {
    const { data: solicitudes, error } = await window.supabaseClient
        .from('solicitudes_retiro')
        .select('id, cantidad, motivo, creado_en, usuario_id, perfiles!solicitudes_retiro_usuario_id_fkey(nombre, usuario)')
        .eq('estado', 'pendiente')
        .order('creado_en');
    if (error) {
        console.error(error);
        return;
    }

    const cardsContainer = document.getElementById('admin-solicitudes-cards');
    const vacioMsg = document.getElementById('admin-solicitudes-vacio');
    cardsContainer.innerHTML = '';

    if (solicitudes.length === 0) {
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
        card.innerHTML = `
            <div class="solicitud-card-header">
                <span class="solicitud-card-nombre">${nombreMostrar}</span>
                <span class="solicitud-card-monto">$${Number(s.cantidad).toFixed(2)}</span>
            </div>
            <div class="solicitud-card-detalles">
                ${new Date(s.creado_en).toLocaleString()}${s.motivo ? ' · ' + s.motivo : ''}
            </div>
            <div class="solicitud-card-acciones">
                <button class="btn btn-success" onclick="window.aprobarSolicitud('${s.id}', '${s.usuario_id}', ${s.cantidad})">Aprobar</button>
                <button class="btn btn-danger" onclick="window.rechazarSolicitud('${s.id}', '${s.usuario_id}', ${s.cantidad}, '${nombreMostrar.replace(/'/g, "\\'")}')">Rechazar</button>
                <button class="btn" onclick="avisarTiempoSolicitud('${s.usuario_id}')">🕐 Avisar tiempo</button>
            </div>
        `;
        cardsContainer.appendChild(card);
    });
}

if (typeof window !== 'undefined') {
    window.loadAdminSolicitudes = loadAdminSolicitudes;
}
