/** Fase 3 / Oleada 8 — Auditoría */

function crearTextoAuditoria(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? '' : String(value);
    return element;
}

export async function loadAdminAuditoria() {
    const container = document.getElementById('audit-log');
    const vacioMsg = document.getElementById('audit-log-vacio');
    const filtroTipo = document.getElementById('audit-filter-tipo').value;
    const fechaDesde = document.getElementById('audit-filter-fecha-desde').value; // 'YYYY-MM-DD' o ''
    const fechaHasta = document.getElementById('audit-filter-fecha-hasta').value;
    const filtroUsuario = document.getElementById('audit-filter-usuario').value.trim().toLowerCase();
    const filtroTexto = document.getElementById('audit-filter-texto').value.trim().toLowerCase();
    container.replaceChildren();

    cargarDatalistUsuariosAuditoria();

    // RLS solo deja ver esto a admins
    const { data: auditoria, error } = await window.supabaseClient
        .from('auditoria')
        .select('*')
        .order('creado_en', { ascending: false });

    if (error) {
        console.error(error);
        container.replaceChildren(crearTextoAuditoria('p', '', 'No se pudo cargar la auditoría.'));
        return;
    }

    // E13 (v71): los 4 filtros se combinan con AND - un evento solo se
    // muestra si pasa TODOS los que estén activos (mismo criterio
    // combinable que F4 en el historial del trabajador).
    const auditoriaFiltrada = (auditoria || []).filter(a => {
        if (filtroTipo !== '' && window.categoriaAuditoria(a.accion) !== filtroTipo) return false;

        if (fechaDesde || fechaHasta) {
            const fechaEvento = String(a.creado_en || '').slice(0, 10);
            if (fechaDesde && fechaEvento < fechaDesde) return false;
            if (fechaHasta && fechaEvento > fechaHasta) return false;
        }

        if (filtroUsuario !== '') {
            const nombre = String(a.usuario_nombre || '').toLowerCase();
            if (!nombre.includes(filtroUsuario)) return false;
        }

        if (filtroTexto !== '') {
            if (!String(a.accion || '').toLowerCase().includes(filtroTexto)) return false;
        }

        return true;
    });

    if (auditoriaFiltrada.length === 0) {
        container.classList.add('hidden');
        vacioMsg.classList.remove('hidden');
        return;
    }
    container.classList.remove('hidden');
    vacioMsg.classList.add('hidden');

    const iconoAuditoria = { retiro: '💸', saldo: '💰', usuario: '👤', login: '🔑', otro: '📋' };

    auditoriaFiltrada.forEach(a => {
        const categoriaOriginal = window.categoriaAuditoria(a.accion);
        const categoria = Object.prototype.hasOwnProperty.call(iconoAuditoria, categoriaOriginal)
            ? categoriaOriginal : 'otro';
        // F-AUDITORIA-UI: limpiamos identificadores históricos antes de mostrarlos.
        const accionLimpia = String(a.accion || '')
            .replace(/\s*\(id:\s*[0-9a-f-]+\)/gi, '')
            .replace(/usuario ID:\s*[0-9a-f-]+/gi, 'un usuario');
        const logEntry = document.createElement('div');
        logEntry.className = 'audit-entry';

        const icon = crearTextoAuditoria('div', 'audit-entry-icon', iconoAuditoria[categoria]);
        const body = document.createElement('div');
        body.className = 'audit-entry-body';
        body.appendChild(crearTextoAuditoria('div', 'audit-entry-accion', accionLimpia));

        const meta = document.createElement('div');
        meta.className = 'audit-entry-meta';
        meta.appendChild(crearTextoAuditoria('span', 'audit-entry-usuario', a.usuario_nombre || 'N/A'));
        meta.appendChild(crearTextoAuditoria('span', '', '·'));
        meta.appendChild(crearTextoAuditoria('span', '', new Date(a.creado_en).toLocaleString()));

        body.appendChild(meta);
        logEntry.appendChild(icon);
        logEntry.appendChild(body);
        container.appendChild(logEntry);
    });
}

export function debounceFiltroAuditoria() {
    clearTimeout(debounceFiltroAuditoriaId);
    debounceFiltroAuditoriaId = setTimeout(() => {
        loadAdminAuditoria();
    }, 350);
}

export async function cargarDatalistUsuariosAuditoria() {
    if (datalistUsuariosAuditoriaCargado) return;
    const { data, error } = await window.supabaseClient
        .from('auditoria')
        .select('usuario_nombre');
    if (error) {
        console.error('Error cargando nombres para el filtro de auditoría:', error);
        return;
    }
    const nombresUnicos = [...new Set((data || []).map(a => a.usuario_nombre).filter(Boolean))].sort();
    const datalist = document.getElementById('audit-usuarios-datalist');
    if (!datalist) return;
    const fragment = document.createDocumentFragment();
    nombresUnicos.forEach(nombre => {
        const option = document.createElement('option');
        option.value = String(nombre);
        fragment.appendChild(option);
    });
    datalist.replaceChildren(fragment);
    datalistUsuariosAuditoriaCargado = true;
}

if (typeof window !== 'undefined') {
    window.loadAdminAuditoria = loadAdminAuditoria;
    window.debounceFiltroAuditoria = debounceFiltroAuditoria;
    window.cargarDatalistUsuariosAuditoria = cargarDatalistUsuariosAuditoria;
}
