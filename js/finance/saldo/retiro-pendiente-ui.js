/**
 * CuevaCoin — js/finance/saldo/retiro-pendiente-ui.js
 * Muestra el monto de retiro en estado "pendiente" (reservado).
 *
 * Regla de negocio:
 * - Al solicitar retiro, la RPC descuenta del saldo disponible y deja
 *   el monto reservado en solicitudes_retiro (estado pendiente).
 * - Si el admin APRUEBA: el saldo ya estaba descontado; solo se quita
 *   el aviso de pendiente (no hay segundo descuento).
 * - Si el admin RECHAZA: la RPC devuelve el monto al saldo; se oculta
 *   el pendiente y Realtime actualiza el número disponible.
 */

/**
 * Pinta o limpia la línea "Retiro pendiente / reservado" en Inicio.
 * @param {number|null|undefined} monto  suma pendiente; 0/null oculta
 */
export function pintarRetiroPendienteUI(monto) {
    const wrap = document.getElementById('user-retiro-pendiente');
    const span = document.getElementById('user-retiro-pendiente-monto');
    if (!wrap || !span) return;
    const n = Number(monto);
    if (!n || Number.isNaN(n) || n <= 0) {
        wrap.classList.add('hidden');
        span.textContent = '0.00';
        return;
    }
    span.textContent = n.toFixed(2);
    wrap.classList.remove('hidden');
}

/**
 * Consulta solicitudes_retiro pendientes del usuario y actualiza la UI.
 * Falla en silencio si RLS no permite leer (no rompe el dashboard).
 */
export async function actualizarRetiroPendienteUI(usuarioId) {
    if (!usuarioId || !window.supabaseClient) {
        pintarRetiroPendienteUI(0);
        return 0;
    }
    try {
        const { data, error } = await window.supabaseClient
            .from('solicitudes_retiro')
            .select('cantidad, estado')
            .eq('usuario_id', usuarioId)
            .eq('estado', 'pendiente');
        if (error) {
            console.error('No se pudo leer retiro pendiente:', error);
            return null;
        }
        const total = (data || []).reduce((acc, row) => acc + (Number(row.cantidad) || 0), 0);
        pintarRetiroPendienteUI(total);
        return total;
    } catch (err) {
        console.error('Error actualizando retiro pendiente UI:', err);
        return null;
    }
}

if (typeof window !== 'undefined') {
    window.pintarRetiroPendienteUI = pintarRetiroPendienteUI;
    window.actualizarRetiroPendienteUI = actualizarRetiroPendienteUI;
}
