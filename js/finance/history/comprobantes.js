/** Fase 3 / Oleada 6 — Comprobantes */

export function generarTextoComprobante(t) {
    const fecha = new Date(t.creado_en).toLocaleString('es', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const cantidad = Number(t.cantidad);
    const signo = cantidad >= 0 ? '+' : '-';
    const lineas = [
        'Comprobante CuevaCoin',
        `Fecha: ${fecha}`,
        `Tipo: ${t.tipoEtiqueta}`,
        `Monto: ${signo}$${Math.abs(cantidad).toFixed(2)}`,
        `Motivo: ${t.motivo || 'Sin motivo'}`,
        `Saldo después: ${t.saldo_despues != null ? '$' + Number(t.saldo_despues).toFixed(2) : '-'}`,
    ];
    return lineas.join('\n');
}

export async function compartirComprobante(t) {
    const texto = window.generarTextoComprobante(t);
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Comprobante CuevaCoin', text: texto });
            return;
        } catch (err) {
            // Si el usuario cancela el diálogo de compartir, no hacemos nada más.
            if (err && err.name === 'AbortError') return;
            console.error('Error compartiendo comprobante:', err);
        }
    }
    try {
        await navigator.clipboard.writeText(texto);
        window.showToast('Comprobante copiado al portapapeles', 2500);
    } catch (err) {
        console.error('Error copiando comprobante:', err);
        window.showToast('No se pudo copiar el comprobante', 3000);
    }
}

if (typeof window !== 'undefined') {
    window.generarTextoComprobante = generarTextoComprobante;
    window.compartirComprobante = compartirComprobante;
}
