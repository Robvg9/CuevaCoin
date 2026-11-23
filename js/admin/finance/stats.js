/**
 * CuevaCoin — loadAdminStats
 * V148: muestra el resumen local inmediatamente y solo lo sustituye
 * cuando las tres consultas de Supabase han terminado sin errores.
 */
const CACHE_PREFIX = 'cuevacoin_admin_stats_v2:';

function obtenerAdminActual() {
    try {
        const admin = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
        return admin?.esAdmin && admin.id ? admin : null;
    } catch (_error) {
        return null;
    }
}

function leerResumenCacheado(key) {
    if (!key) return null;
    try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        if (!value || value.version !== 2
            || !Number.isFinite(value.totalUsuarios)
            || !Number.isFinite(value.saldoTotal)
            || !Number.isFinite(value.solicitudesPendientes)
            || !Number.isFinite(value.transferenciasHoy)
            || typeof value.updatedAt !== 'string') return null;
        return value;
    } catch (_error) {
        return null;
    }
}

function pintarResumen(resumen, estado) {
    const totalUsuarios = document.getElementById('total-usuarios');
    const totalSaldo = document.getElementById('total-saldo');
    const solicitudes = document.getElementById('solicitudes-pendientes');
    const transferencias = document.getElementById('transferencias-hoy');
    const status = document.getElementById('admin-stats-cache-status');

    if (totalUsuarios) totalUsuarios.textContent = String(resumen.totalUsuarios);
    if (totalSaldo) totalSaldo.textContent = '$' + Math.round(resumen.saldoTotal).toLocaleString('es-PR');
    if (solicitudes) solicitudes.textContent = String(resumen.solicitudesPendientes);
    if (transferencias) transferencias.textContent = String(resumen.transferenciasHoy);

    if (status) {
        const fecha = new Date(resumen.updatedAt);
        const fechaTexto = Number.isNaN(fecha.getTime()) ? 'fecha desconocida'
            : fecha.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        status.textContent = estado === 'cache'
            ? '📴 Último resumen guardado · ' + fechaTexto + ' · se actualizará al conectar'
            : 'Actualizado ahora · ' + fechaTexto;
    }
}

function mostrarSinResumenDisponible() {
    ['total-usuarios', 'solicitudes-pendientes', 'transferencias-hoy'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
    });
    const saldo = document.getElementById('total-saldo');
    if (saldo) saldo.textContent = '—';
    const status = document.getElementById('admin-stats-cache-status');
    if (status) status.textContent = 'Aún no hay un resumen guardado en este dispositivo.';
}

export async function loadAdminStats() {
    const admin = obtenerAdminActual();
    const cacheKey = admin ? CACHE_PREFIX + admin.id : null;
    const cached = leerResumenCacheado(cacheKey);

    if (cached) pintarResumen(cached, 'cache');
    else mostrarSinResumenDisponible();

    try {
        const [perfilesResult, solicitudesResult, transferenciasResult] = await Promise.all([
            window.supabaseClient.from('perfiles').select('saldo').eq('es_admin', false).eq('es_dependiente', true),
            window.supabaseClient.from('solicitudes_retiro')
                .select('id, perfiles!solicitudes_retiro_usuario_id_fkey!inner(es_dependiente)', { count: 'exact', head: true })
                .eq('estado', 'pendiente').eq('perfiles.es_dependiente', true),
            (() => {
                const inicioHoy = new Date();
                inicioHoy.setHours(0, 0, 0, 0);
                return window.supabaseClient.from('transacciones')
                    .select('id, trabajadora:perfiles!transacciones_usuario_id_fkey!inner(es_dependiente)', { count: 'exact', head: true })
                    .eq('tipo', 'transferencia').eq('trabajadora.es_dependiente', true)
                    .gte('creado_en', inicioHoy.toISOString());
            })()
        ]);

        const error = perfilesResult.error || solicitudesResult.error || transferenciasResult.error;
        if (error) throw error;

        const perfiles = perfilesResult.data || [];
        const resumen = {
            version: 2,
            totalUsuarios: perfiles.length,
            saldoTotal: perfiles.reduce((total, perfil) => {
                const saldo = Number(perfil.saldo);
                return total + (Number.isFinite(saldo) ? saldo : 0);
            }, 0),
            solicitudesPendientes: solicitudesResult.count ?? 0,
            transferenciasHoy: transferenciasResult.count ?? 0,
            updatedAt: new Date().toISOString()
        };

        if (cacheKey) {
            try { localStorage.setItem(cacheKey, JSON.stringify(resumen)); }
            catch (cacheError) { console.warn('[CuevaCoin] No se pudo guardar el resumen del admin:', cacheError); }
        }
        pintarResumen(resumen, 'live');

        const dot = document.getElementById('solicitudes-retiro-dot');
        if (dot) dot.classList.toggle('hidden', !(resumen.solicitudesPendientes > 0));
    } catch (error) {
        console.warn('[CuevaCoin] No se pudieron refrescar las estadísticas del admin:', error);
        if (cached) pintarResumen(cached, 'cache');
        else {
            mostrarSinResumenDisponible();
            const status = document.getElementById('admin-stats-cache-status');
            if (status) status.textContent = 'Sin conexión y sin un resumen anterior guardado.';
        }
    }
}

if (typeof window !== 'undefined') window.loadAdminStats = loadAdminStats;
