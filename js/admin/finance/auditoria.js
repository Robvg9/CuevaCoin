/** CuevaCoin — Auditoría administrativa con paginación real desde Supabase. */
import { getLocalDateRange } from '../../utils/local-date-range.js?v=152';
const AUDIT_PAGE_SIZE = 25;
let auditOffset = 0, auditHasMore = false, auditLoading = false, auditToken = 0, auditDebounce = null, auditUsersLoaded = false;

function auditText(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = value == null ? '' : String(value);
    return el;
}
function auditFilters() {
    return {
        tipo: document.getElementById('audit-filter-tipo')?.value || '',
        desde: document.getElementById('audit-filter-fecha-desde')?.value || '',
        hasta: document.getElementById('audit-filter-fecha-hasta')?.value || '',
        usuario: (document.getElementById('audit-filter-usuario')?.value || '').trim(),
        texto: (document.getElementById('audit-filter-texto')?.value || '').trim()
    };
}
function applyAuditFilters(query, filters) {
    if (filters.tipo === 'retiro') query = query.ilike('accion', '%retiro%');
    if (filters.tipo === 'saldo') query = query.ilike('accion', '%saldo%');
    if (filters.tipo === 'usuario') query = query.ilike('accion', '%usuario%');
    if (filters.tipo === 'login') query = query.or('accion.ilike.%sesion%,accion.ilike.%sesión%');
    const dateRange = getLocalDateRange(filters.desde, filters.hasta);
    if (dateRange.start) query = query.gte('creado_en', dateRange.start);
    if (dateRange.endExclusive) query = query.lt('creado_en', dateRange.endExclusive);
    if (filters.usuario) query = query.ilike('usuario_nombre', '%' + filters.usuario + '%');
    if (filters.texto) query = query.ilike('accion', '%' + filters.texto + '%');
    return query;
}
function renderAuditEntry(row) {
    const icons = { retiro: '💸', saldo: '💰', usuario: '👤', login: '🔑', otro: '📋' };
    const raw = window.categoriaAuditoria(row.accion);
    const category = Object.prototype.hasOwnProperty.call(icons, raw) ? raw : 'otro';
    const action = String(row.accion || '')
        .replace(/\s*\(id:\s*[0-9a-f-]+\)/gi, '')
        .replace(/usuario ID:\s*[0-9a-f-]+/gi, 'un usuario');
    const entry = document.createElement('article');
    entry.className = 'audit-entry';
    entry.appendChild(auditText('div', 'audit-entry-icon', icons[category]));
    const body = document.createElement('div');
    body.className = 'audit-entry-body';
    body.appendChild(auditText('div', 'audit-entry-accion', action));
    const meta = document.createElement('div');
    meta.className = 'audit-entry-meta';
    meta.append(auditText('span', 'audit-entry-usuario', row.usuario_nombre || 'N/A'), auditText('span', '', '·'));
    const date = new Date(row.creado_en);
    meta.appendChild(auditText('span', '', Number.isNaN(date.getTime()) ? 'Fecha desconocida' : date.toLocaleString()));
    body.appendChild(meta);
    entry.appendChild(body);
    return entry;
}
function updateAuditMore() {
    const button = document.getElementById('audit-ver-mas-btn');
    const status = document.getElementById('audit-load-more-status');
    if (button) {
        button.classList.toggle('hidden', !auditHasMore);
        button.disabled = auditLoading;
        button.textContent = auditLoading ? 'Cargando…' : 'Ver más';
    }
    if (status) status.textContent = auditLoading ? 'Cargando los siguientes eventos…' : '';
}
export async function loadAdminAuditoria(options = {}) {
    const append = options.append === true;
    const container = document.getElementById('audit-log');
    const empty = document.getElementById('audit-log-vacio');
    if (!container || !empty || !window.supabaseClient) return;
    if (append && (auditLoading || !auditHasMore)) return;

    if (!append) {
        auditToken += 1;
        auditOffset = 0;
        auditHasMore = false;
        container.replaceChildren();
    }
    const token = auditToken;
    auditLoading = true;
    updateAuditMore();
    void cargarDatalistUsuariosAuditoria();

    try {
        let query = window.supabaseClient.from('auditoria')
            .select('id, usuario_nombre, accion, creado_en')
            .order('creado_en', { ascending: false })
            .order('id', { ascending: false })
            .range(auditOffset, auditOffset + AUDIT_PAGE_SIZE - 1);
        query = applyAuditFilters(query, auditFilters());
        const { data, error } = await query;
        if (token !== auditToken) return;
        if (error) throw error;

        const rows = data || [];
        rows.forEach(row => container.appendChild(renderAuditEntry(row)));
        auditOffset += rows.length;
        auditHasMore = rows.length === AUDIT_PAGE_SIZE;
        container.classList.toggle('hidden', auditOffset === 0);
        empty.classList.toggle('hidden', auditOffset > 0);
    } catch (error) {
        if (token === auditToken) {
            console.error('[CuevaCoin] No se pudo cargar la auditoría:', error);
            if (!append) container.replaceChildren(auditText('p', '', 'No se pudo cargar la auditoría.'));
        }
    } finally {
        if (token === auditToken) {
            auditLoading = false;
            updateAuditMore();
        }
    }
}
export function debounceFiltroAuditoria() {
    clearTimeout(auditDebounce);
    auditDebounce = setTimeout(() => loadAdminAuditoria(), 350);
}
export async function cargarDatalistUsuariosAuditoria() {
    if (auditUsersLoaded || !window.supabaseClient) return;
    const list = document.getElementById('audit-usuarios-datalist');
    if (!list) return;
    const { data, error } = await window.supabaseClient.from('auditoria')
        .select('usuario_nombre')
        .not('usuario_nombre', 'is', null)
        .order('creado_en', { ascending: false })
        .limit(300);
    if (error) {
        console.error('Error cargando nombres recientes para el filtro:', error);
        return;
    }
    const fragment = document.createDocumentFragment();
    [...new Set((data || []).map(row => row.usuario_nombre).filter(Boolean))].sort().forEach(name => {
        const option = document.createElement('option');
        option.value = String(name);
        fragment.appendChild(option);
    });
    list.replaceChildren(fragment);
    auditUsersLoaded = true;
}
if (typeof window !== 'undefined') {
    window.loadAdminAuditoria = loadAdminAuditoria;
    window.debounceFiltroAuditoria = debounceFiltroAuditoria;
    window.cargarDatalistUsuariosAuditoria = cargarDatalistUsuariosAuditoria;
}
