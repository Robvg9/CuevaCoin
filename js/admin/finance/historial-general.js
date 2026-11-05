/** CuevaCoin — Historial General unificado: movimientos financieros + auditoría, cronología única y solo lectura. */
import { getLocalDateRange } from '../../utils/local-date-range.js?v=154';

const HISTORY_PAGE_SIZE = 20;
const streams = {
    transactions: { buffer: [], cursor: null, done: false },
    audit: { buffer: [], cursor: null, done: false }
};
let historyLoading = false;
let historyToken = 0;
let historyDebounce = null;

function histText(tag, cls, value) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.textContent = value == null ? '' : String(value);
    return el;
}
function isAdmin() {
    try { return JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null')?.esAdmin === true; }
    catch (_) { return false; }
}
function resetStreams() {
    for (const stream of Object.values(streams)) {
        stream.buffer = [];
        stream.cursor = null;
        stream.done = false;
    }
}
function readFilters() {
    return {
        type: document.getElementById('admin-general-history-type')?.value || 'todos',
        from: document.getElementById('admin-general-history-from')?.value || '',
        to: document.getElementById('admin-general-history-to')?.value || '',
        search: (document.getElementById('admin-general-history-search')?.value || '').trim()
    };
}
function safeSearchTerm(value) {
    // Los caracteres estructurales de PostgREST no se permiten dentro del OR.
    return String(value || '').replace(/[%,()]/g, ' ').replace(/_/g, '\\_').trim();
}
function dateFiltered(query, filters) {
    const range = getLocalDateRange(filters.from, filters.to);
    if (range.start) query = query.gte('creado_en', range.start);
    if (range.endExclusive) query = query.lt('creado_en', range.endExclusive);
    return query;
}
function transactionQuery(filters) {
    let query = window.supabaseClient.from('transacciones')
        .select('id,usuario_id,admin_id,contraparte_id,tipo,cantidad,motivo,creado_en,trabajadora:perfiles!transacciones_usuario_id_fkey(nombre, usuario),admin:perfiles!transacciones_admin_id_fkey(nombre, usuario),contraparte:perfiles!transacciones_contraparte_id_fkey(nombre, usuario)')
        .order('creado_en', { ascending: false })
        .order('id', { ascending: false })
        .limit(HISTORY_PAGE_SIZE);
    if (filters.type === 'salarios') query = query.eq('tipo', 'deposito_admin').or('motivo.is.null,motivo.not.ilike.Bono:%');
    else if (filters.type === 'bonos') query = query.eq('tipo', 'deposito_admin').ilike('motivo', 'Bono:%');
    else if (filters.type === 'ajustes') query = query.eq('tipo', 'retiro_admin');
    else if (filters.type === 'retiros') query = query.eq('tipo', 'retiro');
    else if (filters.type === 'transferencias') query = query.eq('tipo', 'transferencia');
    query = dateFiltered(query, filters);
    if (filters.search) query = query.ilike('motivo', '%' + safeSearchTerm(filters.search) + '%');
    return query;
}
function auditQuery(filters) {
    let query = window.supabaseClient.from('auditoria')
        .select('id,usuario_nombre,accion,creado_en')
        .order('creado_en', { ascending: false })
        .order('id', { ascending: false })
        .limit(HISTORY_PAGE_SIZE);
    if (filters.type === 'salarios') query = query.ilike('accion', '%salario%');
    else if (filters.type === 'bonos') query = query.ilike('accion', '%bono%');
    else if (filters.type === 'ajustes') query = query.or('accion.ilike.%saldo%,accion.ilike.%ajuste%');
    else if (filters.type === 'retiros') query = query.ilike('accion', '%retiro%');
    else if (filters.type === 'transferencias') query = query.ilike('accion', '%transfer%');
    query = dateFiltered(query, filters);
    if (filters.search) {
        const term = safeSearchTerm(filters.search);
        query = query.or('accion.ilike.%' + term + '%,usuario_nombre.ilike.%' + term + '%');
    }
    return query;
}
function applyKeysetCursor(query, cursor) {
    if (!cursor) return query;
    const timestamp = String(cursor.creado_en || '');
    const id = String(cursor.id || '');
    return query.or('creado_en.lt.' + timestamp + ',and(creado_en.eq.' + timestamp + ',id.lt.' + id + ')');
}
async function fetchNextStream(kind, filters) {
    const state = streams[kind];
    if (state.buffer.length || state.done) return;
    let query = kind === 'transactions' ? transactionQuery(filters) : auditQuery(filters);
    query = applyKeysetCursor(query, state.cursor);
    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    rows.forEach(row => state.buffer.push({ ...row, __kind: kind }));
    if (rows.length) {
        const last = rows[rows.length - 1];
        state.cursor = { creado_en: last.creado_en, id: last.id };
    }
    if (rows.length < HISTORY_PAGE_SIZE) state.done = true;
}
function compareRecent(left, right) {
    const leftTime = Date.parse(left.creado_en) || 0;
    const rightTime = Date.parse(right.creado_en) || 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    const idOrder = String(right.id || '').localeCompare(String(left.id || ''));
    if (idOrder) return idOrder;
    return left.__kind === 'audit' ? -1 : 1;
}
async function takeMergedPage(filters) {
    const page = [];
    while (page.length < HISTORY_PAGE_SIZE) {
        await Promise.all([
            fetchNextStream('transactions', filters),
            fetchNextStream('audit', filters)
        ]);
        const tx = streams.transactions.buffer[0];
        const audit = streams.audit.buffer[0];
        if (!tx && !audit) break;
        if (!audit || (tx && compareRecent(tx, audit) <= 0)) {
            page.push(streams.transactions.buffer.shift());
        } else {
            page.push(streams.audit.buffer.shift());
        }
    }
    return page;
}
function hasMoreHistory() {
    return Object.values(streams).some(stream => stream.buffer.length || !stream.done);
}
function movementInfo(tx) {
    const amount = Number(tx.cantidad || 0);
    if (tx.tipo === 'deposito_admin') {
        const bonus = String(tx.motivo || '').toLowerCase().startsWith('bono:');
        return { key: bonus ? 'bono' : 'salario', label: bonus ? 'Bono' : 'Salario', icon: bonus ? '🎁' : '💵' };
    }
    if (tx.tipo === 'retiro_admin') return amount < 0
        ? { key: 'ajuste', label: 'Descuento admin', icon: '➖' }
        : { key: 'ajuste', label: 'Ajuste admin', icon: '⚖️' };
    if (tx.tipo === 'retiro') return { key: 'retiro', label: 'Retiro', icon: '🏧' };
    if (tx.tipo === 'transferencia') return amount >= 0
        ? { key: 'transferencia', label: 'Transferencia recibida', icon: '💰' }
        : { key: 'transferencia', label: 'Transferencia enviada', icon: '📤' };
    return { key: 'otro', label: String(tx.tipo || 'Movimiento').replaceAll('_', ' '), icon: '📋' };
}
function personName(person) { return person?.nombre || person?.usuario || ''; }
function appendBoldDetail(container, label, value, className) {
    const line = document.createElement('span');
    if (className) line.className = className;
    line.appendChild(document.createTextNode(label));
    const strong = document.createElement('strong');
    strong.textContent = value == null || value === '' ? 'N/A' : String(value);
    line.appendChild(strong);
    container.appendChild(line);
}
function transactionCard(tx) {
    const info = movementInfo(tx);
    const amount = Number(tx.cantidad || 0);
    const date = new Date(tx.creado_en);
    const card = document.createElement('article');
    card.className = 'tx-card admin-general-history-card';
    const header = document.createElement('div');
    header.className = 'tx-card-header';
    const title = document.createElement('div');
    title.className = 'tx-card-titulo';
    title.append(
        histText('span', 'tx-card-tipo ' + info.key, info.label),
        histText('span', 'tx-card-fecha', Number.isNaN(date.getTime()) ? 'Fecha desconocida' : date.toLocaleString())
    );
    const signed = (amount > 0 ? '+' : amount < 0 ? '−' : '') + '$' +
        Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    header.append(
        histText('span', 'tx-card-icono tx-card-icono-' + info.key, info.icon),
        title,
        histText('strong', 'tx-card-monto ' + (amount >= 0 ? 'positivo' : 'negativo'), signed)
    );
    card.appendChild(header);
    const details = document.createElement('div');
    details.className = 'admin-general-history-details';
    appendBoldDetail(details, 'Trabajadora: ', personName(tx.trabajadora) || 'Cuenta no disponible', 'admin-history-detail-worker');
    const admin = personName(tx.admin);
    const counterpart = personName(tx.contraparte);
    if (admin) details.appendChild(histText('span', 'admin-history-detail-admin', 'Por: ' + admin));
    if (counterpart) details.appendChild(histText('span', 'admin-history-detail-counterpart', 'Contraparte: ' + counterpart));
    if (tx.motivo) appendBoldDetail(details, 'Motivo: ', tx.motivo, 'admin-history-motivo');
    card.appendChild(details);
    return card;
}
function auditCategory(action) {
    const value = String(action || '').toLowerCase();
    if (/retiro/.test(value)) return 'retiro';
    if (/saldo|ajuste/.test(value)) return 'ajuste';
    if (/transfer/.test(value)) return 'transferencia';
    if (/salario|sueldo/.test(value)) return 'salario';
    if (/bono/.test(value)) return 'bono';
    if (/usuario|perfil/.test(value)) return 'usuario';
    if (/sesion|sesión|login/.test(value)) return 'login';
    return 'otro';
}
function auditCard(event) {
    const action = String(event.accion || 'Evento administrativo');
    const date = new Date(event.creado_en);
    const card = document.createElement('article');
    card.className = 'tx-card admin-general-history-card admin-general-history-audit';
    const header = document.createElement('div');
    header.className = 'tx-card-header';
    const title = document.createElement('div');
    title.className = 'tx-card-titulo';
    title.append(
        histText('span', 'tx-card-tipo audit', 'Auditoría · ' + auditCategory(action)),
        histText('span', 'tx-card-fecha', Number.isNaN(date.getTime()) ? 'Fecha desconocida' : date.toLocaleString())
    );
    header.append(
        histText('span', 'tx-card-icono tx-card-icono-audit', '🧾'),
        title,
        histText('span', 'tx-card-monto audit', 'Evento')
    );
    card.appendChild(header);
    const details = document.createElement('div');
    details.className = 'admin-general-history-details admin-general-audit-details';
    appendBoldDetail(details, 'Usuario: ', event.usuario_nombre || 'N/A', 'admin-history-detail-worker');
    appendBoldDetail(details, 'Evento: ', action, 'admin-history-motivo');
    card.appendChild(details);
    return card;
}
function updateHistoryMore() {
    const button = document.getElementById('admin-general-history-more');
    const status = document.getElementById('admin-general-history-status');
    const more = hasMoreHistory();
    if (button) {
        button.classList.toggle('hidden', !more);
        button.disabled = historyLoading;
        button.textContent = historyLoading ? 'Cargando…' : 'Ver más';
    }
    if (status && historyLoading) status.textContent = 'Cargando movimientos y eventos…';
}
export async function cargarHistorialGeneral(options = {}) {
    if (!isAdmin()) {
        window.showToast?.('Solo el administrador puede consultar el historial general.', 3000);
        return;
    }
    const append = options.append === true;
    const list = document.getElementById('admin-general-history-list');
    const empty = document.getElementById('admin-general-history-empty');
    if (!list || !window.supabaseClient || (append && historyLoading)) return;
    if (!append) {
        historyToken += 1;
        resetStreams();
        list.replaceChildren();
    }
    const token = historyToken;
    const filters = readFilters();
    historyLoading = true;
    updateHistoryMore();
    try {
        const rows = await takeMergedPage(filters);
        if (token !== historyToken) return;
        rows.forEach(row => list.appendChild(row.__kind === 'audit' ? auditCard(row) : transactionCard(row)));
        list.classList.toggle('hidden', list.children.length === 0);
        if (empty) {
            empty.textContent = list.children.length ? '' : 'No hay movimientos ni eventos que coincidan con estos filtros.';
            empty.classList.toggle('hidden', list.children.length > 0);
        }
    } catch (error) {
        if (token === historyToken) {
            console.error('[CuevaCoin] No se pudo cargar el historial unificado:', error);
            if (!append) {
                list.replaceChildren();
                if (empty) {
                    empty.textContent = 'No se pudo cargar el historial general. Comprueba la conexión e inténtalo de nuevo.';
                    empty.classList.remove('hidden');
                }
            } else {
                window.showToast?.('No se pudieron cargar los siguientes movimientos/eventos.', 4000);
            }
        }
    } finally {
        if (token === historyToken) {
            historyLoading = false;
            updateHistoryMore();
            const status = document.getElementById('admin-general-history-status');
            if (status) status.textContent = list.children.length
                ? list.children.length + ' movimientos y eventos visibles'
                : '';
        }
    }
}
export function debounceHistorialGeneral() {
    clearTimeout(historyDebounce);
    historyDebounce = setTimeout(() => cargarHistorialGeneral(), 350);
}
if (typeof window !== 'undefined') {
    window.cargarHistorialGeneral = cargarHistorialGeneral;
    window.debounceHistorialGeneral = debounceHistorialGeneral;
}