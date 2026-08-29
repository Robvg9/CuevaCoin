/** CuevaCoin — js/admin/finance/stats-helpers.js
 * Fase 4 — Helpers de rango/etiqueta para charts admin (sin RPC).
 */

export function calcularRangoEstadisticas(rango) {
    const ahora = new Date();
    const buckets = [];
    let desde;
    if (rango === 'hoy') {
        desde = new Date(ahora); desde.setHours(0, 0, 0, 0);
        buckets.push({ clave: desde.toISOString().slice(0, 10), etiqueta: 'Hoy', salario: 0, bono: 0 });
    } else if (rango === 'semana') {
        desde = new Date(ahora); desde.setDate(desde.getDate() - 6); desde.setHours(0, 0, 0, 0);
        for (let i = 6; i >= 0; i--) {
            const d = new Date(ahora); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
            buckets.push({ clave: d.toISOString().slice(0, 10), etiqueta: d.toLocaleDateString('es-PR', { weekday: 'short', day: 'numeric' }), salario: 0, bono: 0 });
        }
    } else if (rango === 'año') {
        desde = new Date(ahora.getFullYear(), ahora.getMonth() - 11, 1);
        for (let i = 11; i >= 0; i--) {
            const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
            buckets.push({ clave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, etiqueta: d.toLocaleDateString('es-PR', { month: 'short', year: '2-digit' }), salario: 0, bono: 0 });
        }
    } else { // 'mes' (default) - día por día desde el 1ro hasta hoy
        desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        const diasHastaHoy = ahora.getDate();
        for (let dia = 1; dia <= diasHastaHoy; dia++) {
            const d = new Date(ahora.getFullYear(), ahora.getMonth(), dia);
            buckets.push({ clave: d.toISOString().slice(0, 10), etiqueta: String(dia), salario: 0, bono: 0 });
        }
    }
    return { desde, buckets, rango };
}

export function claveBucketDeFecha(fechaIso, rango) {
    return rango === 'año' ? fechaIso.slice(0, 7) : fechaIso.slice(0, 10);
}

export function etiquetaRangoEstadisticas(rango) {
    return { hoy: 'hoy', semana: 'esta semana', mes: 'este mes', 'año': 'este año' }[rango] || 'este mes';
}

if (typeof window !== 'undefined') {
    window.calcularRangoEstadisticas = calcularRangoEstadisticas;
    window.claveBucketDeFecha = claveBucketDeFecha;
    window.etiquetaRangoEstadisticas = etiquetaRangoEstadisticas;
}
