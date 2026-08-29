/** Fase 3 / Oleada 8 — Auditoría */

export async function loadAdminAuditoria() {
    const container = document.getElementById('audit-log');
    const vacioMsg = document.getElementById('audit-log-vacio');
    const filtroTipo = document.getElementById('audit-filter-tipo').value;
    const fechaDesde = document.getElementById('audit-filter-fecha-desde').value; // 'YYYY-MM-DD' o ''
    const fechaHasta = document.getElementById('audit-filter-fecha-hasta').value;
    const filtroUsuario = document.getElementById('audit-filter-usuario').value.trim().toLowerCase();
    const filtroTexto = document.getElementById('audit-filter-texto').value.trim().toLowerCase();
    container.innerHTML = '';

    cargarDatalistUsuariosAuditoria();

    // RLS solo deja ver esto a admins
    const { data: auditoria, error } = await window.supabaseClient
        .from('auditoria')
        .select('*')
        .order('creado_en', { ascending: false });

    if (error) {
        console.error(error);
        container.innerHTML = '<p>No se pudo cargar la auditoría.</p>';
        return;
    }

    // E13 (v71): los 4 filtros se combinan con AND - un evento solo se
    // muestra si pasa TODOS los que estén activos (mismo criterio
    // combinable que F4 en el historial del trabajador).
    const auditoriaFiltrada = auditoria.filter(a => {
        if (filtroTipo !== '' && window.categoriaAuditoria(a.accion) !== filtroTipo) return false;

        if (fechaDesde || fechaHasta) {
            const fechaEvento = a.creado_en.slice(0, 10);
            if (fechaDesde && fechaEvento < fechaDesde) return false;
            if (fechaHasta && fechaEvento > fechaHasta) return false;
        }

        if (filtroUsuario !== '') {
            const nombre = (a.usuario_nombre || '').toLowerCase();
            if (!nombre.includes(filtroUsuario)) return false;
        }

        if (filtroTexto !== '') {
            if (!(a.accion || '').toLowerCase().includes(filtroTexto)) return false;
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
        const categoria = window.categoriaAuditoria(a.accion);
        // F-AUDITORIA-UI: por las dudas de que quede algún id crudo
        // en registros viejos guardados antes de este fix (ej.
        // "(id: xxxx-xxxx)" o "usuario ID: xxxx-xxxx"), se limpia acá
        // también al mostrar, para que el admin nunca vea un UUID.
        const accionLimpia = (a.accion || '')
            .replace(/\s*\(id:\s*[0-9a-f-]+\)/gi, '')
            .replace(/usuario ID:\s*[0-9a-f-]+/gi, 'un usuario');
        const logEntry = document.createElement('div');
        logEntry.className = 'audit-entry';
        const fecha = new Date(a.creado_en).toLocaleString();
        logEntry.innerHTML = `
            <div class="audit-entry-icon">${iconoAuditoria[categoria] || iconoAuditoria.otro}</div>
            <div class="audit-entry-body">
                <div class="audit-entry-accion">${accionLimpia}</div>
                <div class="audit-entry-meta">
                    <span class="audit-entry-usuario">${a.usuario_nombre || 'N/A'}</span>
                    <span>·</span>
                    <span>${fecha}</span>
                </div>
            </div>
        `;
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
    datalist.innerHTML = nombresUnicos.map(n => `<option value="${n.replace(/"/g, '&quot;')}"></option>`).join('');
    datalistUsuariosAuditoriaCargado = true;
}

if (typeof window !== 'undefined') {
    window.loadAdminAuditoria = loadAdminAuditoria;
    window.debounceFiltroAuditoria = debounceFiltroAuditoria;
    window.cargarDatalistUsuariosAuditoria = cargarDatalistUsuariosAuditoria;
}
