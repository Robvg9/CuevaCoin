/**
 * CuevaCoin — historial financiero individual desde la gestión de usuarios.
 * Solo lectura: consulta el ledger persistido en Supabase y nunca modifica saldos.
 */

const PAGE_SIZE = 500;
const HISTORY_CACHE_DB = 'cuevacoin-offline-read-cache';
const HISTORY_CACHE_STORE = 'adminWorkerHistory';
const HISTORY_CACHE_VERSION = 1;
const HISTORY_CACHE_LIMIT = 50;
let trabajadorActualId = null;
let transaccionesActuales = [];
let renderToken = 0;

function obtenerAdminActual() {
    try {
        return JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    } catch (_error) {
        return null;
    }
}

function obtenerInfoTransaccion(tx) {
    const cantidad = Number(tx?.cantidad || 0);
    switch (tx?.tipo) {
        case 'deposito_admin':
            return { categoria: 'salario', icono: '💵', etiqueta: 'Depósito admin', explicacion: 'El administrador agregó dinero a la cuenta.' };
        case 'retiro_admin':
            return cantidad < 0
                ? { categoria: 'descuento', icono: '➖', etiqueta: 'Descuento admin', explicacion: 'Dinero descontado por el administrador.' }
                : { categoria: 'ajuste', icono: '⚖️', etiqueta: 'Ajuste admin', explicacion: 'Cambio positivo de saldo registrado por el administrador.' };
        case 'retiro':
            return { categoria: 'retiro', icono: '🏧', etiqueta: 'Retiro', explicacion: 'Retiro solicitado por el trabajador.' };
        case 'transferencia':
            return cantidad > 0
                ? { categoria: 'recibido', icono: '💰', etiqueta: 'Transferencia recibida', explicacion: 'Dinero recibido de otra cuenta.' }
                : { categoria: 'enviado', icono: '📤', etiqueta: 'Transferencia enviada', explicacion: 'Dinero enviado a otra cuenta.' };
        default:
            return { categoria: 'ajuste', icono: cantidad >= 0 ? '➕' : '➖', etiqueta: tx?.tipo ? String(tx.tipo).replaceAll('_', ' ') : 'Movimiento', explicacion: 'Movimiento registrado en el historial financiero.' };
    }
}

function textoPersona(persona) {
    if (!persona) return '';
    return persona.nombre || persona.usuario || '';
}

function abrirDBHistorialOffline() {
    if (!window.indexedDB) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(HISTORY_CACHE_DB, HISTORY_CACHE_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(HISTORY_CACHE_STORE)) {
                db.createObjectStore(HISTORY_CACHE_STORE, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('No se pudo abrir la caché offline.'));
    });
}

async function leerHistorialOffline(key) {
    const db = await abrirDBHistorialOffline();
    if (!db) return null;
    return new Promise((resolve, reject) => {
        const request = db.transaction(HISTORY_CACHE_STORE, 'readonly')
            .objectStore(HISTORY_CACHE_STORE).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('No se pudo leer la caché offline.'));
    }).finally(() => db.close());
}

async function guardarHistorialOffline(key, nombre, filas) {
    const db = await abrirDBHistorialOffline();
    if (!db) return;
    const snapshot = {
        key,
        workerName: nombre || 'Trabajador',
        items: (filas || []).slice(0, HISTORY_CACHE_LIMIT).map(tx => ({
            tipo: tx.tipo,
            cantidad: Number(tx.cantidad || 0),
            creado_en: tx.creado_en,
            motivo: tx.motivo || null,
            saldo_antes: tx.saldo_antes ?? null,
            saldo_despues: tx.saldo_despues ?? null,
            admin: tx.admin ? { nombre: tx.admin.nombre || null, usuario: tx.admin.usuario || null } : null,
            contraparte: tx.contraparte ? { nombre: tx.contraparte.nombre || null, usuario: tx.contraparte.usuario || null } : null
        })),
        updatedAt: new Date().toISOString()
    };
    await new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_CACHE_STORE, 'readwrite');
        tx.objectStore(HISTORY_CACHE_STORE).put(snapshot);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('No se pudo guardar la caché offline.'));
        tx.onabort = () => reject(tx.error || new Error('Se canceló el guardado offline.'));
    }).finally(() => db.close());
}

function formatearFechaCompacta(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Fecha desconocida';
    const fecha = date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    const hora = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const anio = date.getFullYear() !== new Date().getFullYear() ? ' ' + date.getFullYear() : '';
    return fecha + anio + ' · ' + hora;
}

function crearTexto(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = value == null ? '' : String(value);
    return el;
}

function formatearDinero(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatearFecha(value) {
    return formatearFechaCompacta(value);
}

async function obtenerTodasLasTransacciones(usuarioId, token) {
    const client = window.supabaseClient;
    if (!client) throw new Error('La conexión con la base de datos no está disponible.');

    const filas = [];
    let desde = 0;
    while (true) {
        const { data, error } = await client
            .from('transacciones')
            .select('*, trabajadora:perfiles!transacciones_usuario_id_fkey!inner(es_dependiente), admin:perfiles!transacciones_admin_id_fkey(nombre, usuario), contraparte:perfiles!transacciones_contraparte_id_fkey(nombre, usuario)')
            .eq('trabajadora.es_dependiente', true)
            .eq('usuario_id', usuarioId)
            .order('creado_en', { ascending: false })
            .range(desde, desde + PAGE_SIZE - 1);

        if (token !== renderToken) return [];
        if (error) throw error;
        const pagina = data || [];
        filas.push(...pagina);
        if (pagina.length < PAGE_SIZE) break;
        desde += PAGE_SIZE;
    }
    return filas;
}

export async function abrirHistorialTrabajadoraAdmin(usuarioId) {
    const admin = obtenerAdminActual();
    if (!admin?.esAdmin) {
        window.showToast('Solo el administrador puede consultar el historial de cada trabajador.', 3500);
        return;
    }
    if (!usuarioId) {
        window.showToast('No se pudo identificar al trabajador.', 3000);
        return;
    }

    const token = ++renderToken;
    trabajadorActualId = usuarioId;
    transaccionesActuales = [];

    const nombreEl = document.getElementById('admin-worker-history-name');
    const estadoEl = document.getElementById('admin-worker-history-status');
    const listaEl = document.getElementById('admin-worker-history-cards');
    const vacioEl = document.getElementById('admin-worker-history-empty');
    const totalEl = document.getElementById('admin-worker-history-total');
    if (!nombreEl || !estadoEl || !listaEl || !vacioEl || !totalEl) return;

    nombreEl.textContent = 'Cargando…';
    estadoEl.textContent = 'Actualizando historial…';
    listaEl.replaceChildren();
    vacioEl.classList.add('hidden');
    totalEl.textContent = '';
    for (const id of ['admin-worker-history-type', 'admin-worker-history-from', 'admin-worker-history-to', 'admin-worker-history-search']) {
        const field = document.getElementById(id);
        if (field) field.value = '';
    }
    window.openModal('admin-worker-history-modal');

    const cacheKey = admin.id + ':' + usuarioId;
    try {
        const cached = await leerHistorialOffline(cacheKey);
        if (token !== renderToken) return;
        if (cached && Array.isArray(cached.items)) {
            transaccionesActuales = cached.items;
            nombreEl.textContent = cached.workerName || 'Trabajador';
            estadoEl.textContent = 'Copia local · ' + formatearFechaCompacta(cached.updatedAt);
            filtrarHistorialTrabajadoraAdmin();
        }
    } catch (cacheError) {
        console.warn('[CuevaCoin] No se pudo leer el historial offline:', cacheError);
    }

    try {
        const [perfilResult, transacciones] = await Promise.all([
            window.supabaseClient
                .from('perfiles')
                .select('nombre, usuario')
                .eq('id', usuarioId)
                .single(),
            obtenerTodasLasTransacciones(usuarioId, token)
        ]);
        if (token !== renderToken) return;
        if (perfilResult.error) throw perfilResult.error;

        const perfil = perfilResult.data || {};
        const nombre = perfil.nombre || perfil.usuario || 'Trabajador';
        nombreEl.textContent = nombre;
        transaccionesActuales = transacciones;
        try {
            await guardarHistorialOffline(cacheKey, nombre, transacciones);
        } catch (cacheError) {
            console.warn('[CuevaCoin] No se pudo guardar el historial offline:', cacheError);
        }
        estadoEl.textContent = transacciones.length
            ? 'Historial actualizado · solo lectura'
            : 'No hay movimientos registrados para este trabajador.';
        filtrarHistorialTrabajadoraAdmin();
    } catch (error) {
        if (token !== renderToken) return;
        console.error('[CuevaCoin] No se pudo cargar el historial individual:', error);
        if (transaccionesActuales.length) {
            estadoEl.textContent = 'Sin conexión · mostrando la última copia guardada en este dispositivo.';
            filtrarHistorialTrabajadoraAdmin();
            return;
        }
        estadoEl.textContent = 'Sin conexión y sin historial guardado para este trabajador en este dispositivo.';
        listaEl.replaceChildren();
        vacioEl.classList.add('hidden');
        totalEl.textContent = '';
    }
}

export function filtrarHistorialTrabajadoraAdmin() {
    const usuarioActual = obtenerAdminActual();
    if (!usuarioActual?.esAdmin || !trabajadorActualId) return;

    const tipo = document.getElementById('admin-worker-history-type')?.value || '';
    const desde = document.getElementById('admin-worker-history-from')?.value || '';
    const hasta = document.getElementById('admin-worker-history-to')?.value || '';
    const texto = (document.getElementById('admin-worker-history-search')?.value || '').trim().toLocaleLowerCase('es');
    const listaEl = document.getElementById('admin-worker-history-cards');
    const vacioEl = document.getElementById('admin-worker-history-empty');
    const totalEl = document.getElementById('admin-worker-history-total');
    if (!listaEl || !vacioEl || !totalEl) return;

    const filas = transaccionesActuales.filter(tx => {
        if (tipo && tx.tipo !== tipo) return false;
        const fecha = String(tx.creado_en || '').slice(0, 10);
        if (desde && fecha < desde) return false;
        if (hasta && fecha > hasta) return false;
        if (texto) {
            const info = obtenerInfoTransaccion(tx);
            const bolsa = [
                info.etiqueta, tx.tipo, tx.motivo, textoPersona(tx.admin),
                textoPersona(tx.contraparte)
            ].filter(Boolean).join(' ').toLocaleLowerCase('es');
            if (!bolsa.includes(texto)) return false;
        }
        return true;
    });

    listaEl.replaceChildren();
    totalEl.textContent = filas.length + (filas.length === 1 ? ' movimiento' : ' movimientos');
    vacioEl.classList.toggle('hidden', filas.length > 0);

    filas.forEach(tx => {
        const info = obtenerInfoTransaccion(tx);
        const amount = Number(tx.cantidad || 0);
        const card = document.createElement('article');
        card.className = 'tx-card admin-history-tx-card';

        const header = document.createElement('div');
        header.className = 'tx-card-header';
        const icon = crearTexto('span', 'tx-card-icono tx-card-icono-' + info.categoria, info.icono);
        icon.title = info.explicacion;
        const titleBox = document.createElement('div');
        titleBox.className = 'tx-card-titulo';
        titleBox.append(
            crearTexto('span', 'tx-card-tipo ' + info.categoria, info.etiqueta),
            crearTexto('span', 'tx-card-fecha', formatearFecha(tx.creado_en))
        );
        const amountEl = crearTexto('div', 'tx-card-monto ' + (amount >= 0 ? 'positivo' : 'negativo'),
            (amount > 0 ? '+' : amount < 0 ? '−' : '') + formatearDinero(Math.abs(amount)));
        header.append(icon, titleBox, amountEl);
        card.append(header);

        const details = document.createElement('div');
        details.className = 'admin-history-details';
        details.append(crearTexto('span', 'admin-history-motivo', '📝 ' + (tx.motivo || 'Sin motivo')));
        const adminName = textoPersona(tx.admin);
        if (adminName) details.append(crearTexto('span', 'admin-history-admin', 'Por: ' + adminName));
        const counterpart = textoPersona(tx.contraparte);
        if (counterpart) details.append(crearTexto('span', 'admin-history-counterpart', '↔ ' + counterpart));
        card.append(details);

        if (tx.saldo_antes != null || tx.saldo_despues != null) {
            const before = tx.saldo_antes != null ? formatearDinero(tx.saldo_antes) : '—';
            const after = tx.saldo_despues != null ? formatearDinero(tx.saldo_despues) : '—';
            card.append(crearTexto('div', 'admin-history-saldos', 'Saldo ' + before + ' → ' + after));
        }
        listaEl.appendChild(card);
    });
}

if (typeof window !== 'undefined') {
    window.abrirHistorialTrabajadoraAdmin = abrirHistorialTrabajadoraAdmin;
    window.filtrarHistorialTrabajadoraAdmin = filtrarHistorialTrabajadoraAdmin;
}
