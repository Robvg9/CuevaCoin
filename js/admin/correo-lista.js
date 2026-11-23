/**
 * CuevaCoin — js/admin/correo-lista.js
 * Lista de solicitudes de cambio de correo pendientes — Oleada 7.
 * Solo render UI; aprobar/rechazar viven en correo-solicitudes.js.
 */

function crearTextoSolicitudCorreo(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? '' : String(value);
    return element;
}

function crearAccionSolicitudCorreo(label, className, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
}

export async function loadAdminSolicitudesCorreo() {
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    if (!client) return;

    const { data: solicitudes, error } = await client
        .from('solicitudes_cambio_correo')
        .select('id, correo_actual, correo_nuevo, motivo, creado_en, usuario_id, perfiles!solicitudes_cambio_correo_usuario_id_fkey!inner(nombre, usuario, es_dependiente)')
        .eq('perfiles.es_dependiente', true)
        .eq('estado', 'pendiente')
        .order('creado_en');
    if (error) {
        console.error(error);
        return;
    }

    const cardsContainer = document.getElementById('admin-solicitudes-correo-cards');
    const vacioMsg = document.getElementById('admin-solicitudes-correo-vacio');
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
        const fecha = new Date(s.creado_en).toLocaleString();
        const correoActual = s.correo_actual || '(sin correo)';
        const correoNuevo = String(s.correo_nuevo || '');
        const motivo = s.motivo ? String(s.motivo) : '';

        const card = document.createElement('div');
        card.className = 'solicitud-card';
        const header = document.createElement('div');
        header.className = 'solicitud-card-header';
        header.appendChild(crearTextoSolicitudCorreo('span', 'solicitud-card-nombre', nombreMostrar));

        const details = document.createElement('div');
        details.className = 'solicitud-card-detalles';
        details.appendChild(crearTextoSolicitudCorreo('span', '', fecha));
        details.appendChild(document.createElement('br'));
        details.appendChild(crearTextoSolicitudCorreo('span', '', 'De: ' + correoActual));
        details.appendChild(document.createElement('br'));
        details.appendChild(crearTextoSolicitudCorreo('span', '', 'A: ' + correoNuevo));
        if (motivo) {
            details.appendChild(document.createElement('br'));
            details.appendChild(crearTextoSolicitudCorreo('span', '', 'Motivo: ' + motivo));
        }

        const actions = document.createElement('div');
        actions.className = 'solicitud-card-acciones';
        actions.appendChild(crearAccionSolicitudCorreo('Aprobar', 'btn btn-success', () => {
            if (typeof window.aprobarCambioCorreo === 'function') {
                window.aprobarCambioCorreo(s.id, s.usuario_id, correoNuevo, String(nombreMostrar));
            }
        }));
        actions.appendChild(crearAccionSolicitudCorreo('Rechazar', 'btn btn-danger', () => {
            if (typeof window.rechazarCambioCorreo === 'function') {
                window.rechazarCambioCorreo(s.id, s.usuario_id, String(nombreMostrar));
            }
        }));

        card.appendChild(header);
        card.appendChild(details);
        card.appendChild(actions);
        cardsContainer.appendChild(card);
    });
}

if (typeof window !== 'undefined') {
    window.loadAdminSolicitudesCorreo = loadAdminSolicitudesCorreo;
}
