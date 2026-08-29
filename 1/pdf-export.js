/** Fase 3 / Oleada 6 — PDF historial / estado de cuenta */

export function exportarHistorialPDF() {
    if (!ultimoHistorialFiltrado || ultimoHistorialFiltrado.length === 0) {
        window.showToast('No hay transacciones para exportar con estos filtros', 3000);
        return;
    }
    if (typeof window.jspdf === 'undefined') {
        window.showToast('No se pudo cargar el generador de PDF, revisa tu conexión', 3000);
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    const margenIzq = 14;
    let y = 18;

    doc.setFontSize(16);
    doc.text('CuevaCoin - Historial de Transacciones', margenIzq, y);
    y += 8;
    doc.setFontSize(10);
    doc.text(`Usuario: ${usuarioActual.nombre || usuarioActual.usuario || ''}`, margenIzq, y);
    y += 5;
    doc.text(`Generado: ${new Date().toLocaleDateString('es-ES')}`, margenIzq, y);
    y += 5;

    const fechaDesde = document.getElementById('user-filter-fecha-desde').value;
    const fechaHasta = document.getElementById('user-filter-fecha-hasta').value;
    if (fechaDesde || fechaHasta) {
        doc.text(`Rango: ${fechaDesde || 'inicio'} a ${fechaHasta || 'hoy'}`, margenIzq, y);
        y += 5;
    }
    y += 4;

    doc.setFontSize(9);
    ultimoHistorialFiltrado.forEach(t => {
        if (y > 280) { // salto de página con margen inferior
            doc.addPage();
            y = 18;
        }
        const cantidad = Number(t.cantidad);
        const fecha = new Date(t.creado_en).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        const signo = cantidad >= 0 ? '+' : '';
        const linea = `${fecha}  |  ${t.tipoEtiqueta || ''}  |  ${signo}$${Math.abs(cantidad).toFixed(2)}  |  ${t.motivo || 'Sin motivo'}`;
        doc.text(linea, margenIzq, y);
        y += 6;
    });

    doc.save(`cuevacoin-historial-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function abrirEstadoCuentaModal() {
    const input = document.getElementById('estado-cuenta-mes');
    if (!input.value) {
        input.value = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    }
    document.getElementById('estado-cuenta-vacio').classList.add('hidden');
    window.openModal('estado-cuenta-modal');
}

export async function generarEstadoCuentaPDF() {
    const mesInput = document.getElementById('estado-cuenta-mes').value; // 'YYYY-MM'
    if (!mesInput) {
        window.showToast('Elige un mes primero', 3000);
        return;
    }
    if (typeof window.jspdf === 'undefined') {
        window.showToast('No se pudo cargar el generador de PDF, revisa tu conexión', 3000);
        return;
    }

    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    const inicioMes = `${mesInput}-01`;
    const [anio, mes] = mesInput.split('-').map(Number);
    const finMesDate = new Date(anio, mes, 0); // último día del mes elegido
    const finMes = finMesDate.toISOString().slice(0, 10);

    // RLS ya limita esto a las propias transacciones del usuario.
    const { data: todas, error } = await window.supabaseClient
        .from('transacciones')
        .select('*')
        .eq('usuario_id', usuarioActual.id)
        .order('creado_en', { ascending: true });

    if (error) {
        console.error(error);
        window.showToast('No se pudo generar el estado de cuenta', 3000);
        return;
    }

    const antesDelMes = (todas || []).filter(t => t.creado_en.slice(0, 10) < inicioMes);
    const delMes = (todas || []).filter(t => {
        const fechaTx = t.creado_en.slice(0, 10);
        return fechaTx >= inicioMes && fechaTx <= finMes;
    });

    document.getElementById('estado-cuenta-vacio').classList.toggle('hidden', delMes.length !== 0);
    if (delMes.length === 0 && antesDelMes.length === 0) {
        return; // nunca hubo ningún movimiento, ni antes ni durante el mes
    }

    const saldoInicial = antesDelMes.length > 0
        ? Number(antesDelMes[antesDelMes.length - 1].saldo_despues)
        : 0;
    const saldoFinal = delMes.length > 0
        ? Number(delMes[delMes.length - 1].saldo_despues)
        : saldoInicial;

    let totalDepositos = 0, totalRetiros = 0, totalBonos = 0;
    delMes.forEach(t => {
        const cantidad = Number(t.cantidad);
        if (t.tipo === 'retiro' || t.tipo === 'retiro_admin') totalRetiros += Math.abs(cantidad);
        else if (t.tipo === 'deposito_admin') totalBonos += Math.abs(cantidad);
        else if (cantidad > 0) totalDepositos += cantidad;
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const margenIzq = 14;
    let y = 18;
    const nombreMes = finMesDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

    doc.setFontSize(16);
    doc.text('CuevaCoin - Estado de Cuenta', margenIzq, y);
    y += 8;
    doc.setFontSize(10);
    doc.text(`Usuario: ${usuarioActual.nombre || usuarioActual.usuario || ''}`, margenIzq, y);
    y += 5;
    doc.text(`Mes: ${nombreMes}`, margenIzq, y);
    y += 5;
    doc.text(`Generado: ${new Date().toLocaleDateString('es-ES')}`, margenIzq, y);
    y += 9;

    doc.setFontSize(11);
    doc.text(`Saldo inicial: $${saldoInicial.toFixed(2)}`, margenIzq, y);
    y += 6;
    doc.text(`Saldo final: $${saldoFinal.toFixed(2)}`, margenIzq, y);
    y += 6;
    doc.text(`Total depósitos/transferencias recibidas: $${totalDepositos.toFixed(2)}`, margenIzq, y);
    y += 6;
    doc.text(`Total retiros: $${totalRetiros.toFixed(2)}`, margenIzq, y);
    y += 6;
    doc.text(`Total salarios/bonos: $${totalBonos.toFixed(2)}`, margenIzq, y);
    y += 10;

    doc.setFontSize(12);
    doc.text('Detalle de movimientos', margenIzq, y);
    y += 7;
    doc.setFontSize(9);

    if (delMes.length === 0) {
        doc.text('Sin movimientos este mes.', margenIzq, y);
    } else {
        delMes.forEach(t => {
            if (y > 280) {
                doc.addPage();
                y = 18;
            }
            const cantidad = Number(t.cantidad);
            const fecha = new Date(t.creado_en).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
            const signo = cantidad >= 0 ? '+' : '';
            const linea = `${fecha}  |  ${t.tipo || ''}  |  ${signo}$${Math.abs(cantidad).toFixed(2)}  |  ${t.motivo || 'Sin motivo'}`;
            doc.text(linea, margenIzq, y);
            y += 6;
        });
    }

    doc.save(`cuevacoin-estado-cuenta-${mesInput}.pdf`);
}

if (typeof window !== 'undefined') {
    window.exportarHistorialPDF = exportarHistorialPDF;
    window.abrirEstadoCuentaModal = abrirEstadoCuentaModal;
    window.generarEstadoCuentaPDF = generarEstadoCuentaPDF;
}
