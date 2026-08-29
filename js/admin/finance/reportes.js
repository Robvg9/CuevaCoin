/** Fase 3 / Oleada 8 — Reportes */

export async function generarReporteDiario() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    try {
        const { data: transacciones } = await window.supabaseClient
            .from('transacciones')
            .select('*')
            .gte('creado_en', hoy.toISOString());
        const totalDepositos = transacciones.filter(t => t.cantidad > 0).reduce((sum, t) => sum + Number(t.cantidad), 0);
        const totalRetiros = transacciones.filter(t => t.cantidad < 0).reduce((sum, t) => sum + Math.abs(Number(t.cantidad)), 0);
        document.getElementById('reporte-contenido').innerHTML = `
            <p><strong>Fecha:</strong> ${hoy.toLocaleDateString()}</p>
            <p><strong>Total Depósitos:</strong> $${totalDepositos.toFixed(2)}</p>
            <p><strong>Total Retiros:</strong> $${totalRetiros.toFixed(2)}</p>
            <p><strong>Transacciones:</strong> ${transacciones.length}</p>
        `;
    } catch (error) {
        document.getElementById('reporte-contenido').innerHTML = '<p>Error al generar reporte</p>';
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
