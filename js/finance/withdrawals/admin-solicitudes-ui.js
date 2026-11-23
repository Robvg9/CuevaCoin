/** Fase 3 / Oleada 5 — loadAdminSolicitudes (UI lista) */

function crearTextoSolicitud(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? '' : String(value);
    return element;
}

function crearAccionSolicitud(label, className, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
}

export async function loadAdminSolicitudes() {
    const { data: solicitudes, error } = await window.supabaseClient
        .from('solicitudes_retiro')
        .select('id, cantidad, motivo, creado_en, usuario_id, perfiles!solicitudes_retiro_usuario_id_fkey!inner(nombre, usuario, es_dependiente)')
        .eq('perfiles.es_dependiente', true)
        .eq('estado', 'pendiente')
        .order('creado_en');
    if (error) {
        console.error(error);
        return;
    }

    const cardsContainer = document.getElementById('admin-solicitudes-cards');
    const vacioMsg = document.getElementById('admin-solicitudes-vacio');
    if (!cardsContainer || !vacioMsg) return;
    cardsContainer.replaceChildren();

    if (!solicitudes || solicitudes.length === 0) {
        cardsContainer.classList.add('hidden');
        vacioMsg.classList.remove('hidden');
        return;
    }
    cardsContainer.classList.remove('hidden');
    vacioMsg.classList.add('hidden');

    solicitudes.forEach(s => {
        const nombreMostrar = (s.perfiles && (s.perfiles.nombre || s.perfiles.usuario)) || 'N/A';
        const cantidad = Number(s.cantidad);
        const fecha = new Date(s.creado_en).toLocaleString();
        const card = document.createElement('div');
        card.className = 'solicitud-card';

        const header = document.createElement('div');
        header.className = 'solicitud-card-header';
        header.appendChild(crearTextoSolicitud('span', 'solicitud-card-nombre', nombreMostrar));
        header.appendChild(crearTextoSolicitud('span', 'solicitud-card-monto',
            '$' + (Number.isFinite(cantidad) ? cantidad.toFixed(2) : '0.00')));

        const details = crearTextoSolicitud('div', 'solicitud-card-detalles',
            fecha + (s.motivo ? ' · ' + String(s.motivo) : ''));

        const actions = document.createElement('div');
        actions.className = 'solicitud-card-acciones';
        actions.appendChild(crearAccionSolicitud('Aprobar', 'btn btn-success', () => {
            if (typeof window.aprobarSolicitud === 'function') {
                window.aprobarSolicitud(s.id, s.usuario_id, cantidad);
            }
        }));
        actions.appendChild(crearAccionSolicitud('Rechazar', 'btn btn-danger', () => {
            if (typeof window.rechazarSolicitud === 'function') {
                window.rechazarSolicitud(s.id, s.usuario_id, cantidad, String(nombreMostrar));
            }
        }));
        actions.appendChild(crearAccionSolicitud('🕐 Avisar tiempo', 'btn', () => {
            if (typeof window.avisarTiempoSolicitud === 'function') {
                window.avisarTiempoSolicitud(s.usuario_id);
            }
        }));

        card.appendChild(header);
        card.appendChild(details);
        card.appendChild(actions);
        cardsContainer.appendChild(card);
    });
}

if (typeof window !== 'undefined') {
    window.loadAdminSolicitudes = loadAdminSolicitudes;
}
