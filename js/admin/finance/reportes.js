/** Fase 3 / Oleada 8 — Reportes */

function crearLineaReporte(etiqueta, valor) {
    const line = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = etiqueta + ':';
    const text = document.createElement('span');
    text.textContent = ' ' + String(valor);
    line.appendChild(strong);
    line.appendChild(text);
    return line;
}

function mostrarErrorReporte(message) {
    const container = document.getElementById('reporte-contenido');
    if (!container) return;
    const error = document.createElement('p');
    error.textContent = message;
    container.replaceChildren(error);
}

export async function generarReporteDiario() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const container = document.getElementById('reporte-contenido');
    if (!container) return;

    container.replaceChildren();
    const loading = document.createElement('p');
    loading.textContent = 'Generando reporte…';
    container.appendChild(loading);

    try {
        const { data: transacciones, error } = await window.supabaseClient
            .from('transacciones')
            .select('cantidad')
            .gte('creado_en', hoy.toISOString());
        if (error) throw error;

        const filas = Array.isArray(transacciones) ? transacciones : [];
        const totalDepositos = filas.reduce((sum, t) => {
            const amount = Number(t.cantidad);
            return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
        }, 0);
        const totalRetiros = filas.reduce((sum, t) => {
            const amount = Number(t.cantidad);
            return Number.isFinite(amount) && amount < 0 ? sum + Math.abs(amount) : sum;
        }, 0);

        const fragment = document.createDocumentFragment();
        fragment.appendChild(crearLineaReporte('Fecha', hoy.toLocaleDateString()));
        fragment.appendChild(crearLineaReporte('Total Depósitos', '$' + totalDepositos.toFixed(2)));
        fragment.appendChild(crearLineaReporte('Total Retiros', '$' + totalRetiros.toFixed(2)));
        fragment.appendChild(crearLineaReporte('Transacciones', filas.length));
        container.replaceChildren(fragment);
    } catch (error) {
        console.error('No se pudo generar el reporte diario:', error);
        mostrarErrorReporte('Error al generar reporte');
    }
}

export function abrirModalReporte() {
    window.openModal('reporte-diario-modal');
    generarReporteDiario();
}

if (typeof window !== 'undefined') {
    window.generarReporteDiario = generarReporteDiario;
    window.abrirModalReporte = abrirModalReporte;
}
