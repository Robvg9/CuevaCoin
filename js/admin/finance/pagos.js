/** CuevaCoin — pagos administrativos; salario individual usa un único lote atómico. */
function pendingSalary() {
    try {
        const raw = sessionStorage.getItem('cuevacoin_salary_batch_pending');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed.key === 'string' && Array.isArray(parsed.payload) ? parsed : null;
    } catch (_error) { return null; }
}
function newIdempotencyKey() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    throw new Error('Este navegador no permite generar una clave segura para el pago. Actualiza la aplicación e inténtalo de nuevo.');
}
function validateSalaryRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Selecciona al menos una trabajadora.');
    const ids = new Set();
    return rows.map(row => {
        const id = String(row.id || '');
        const amount = Number(row.monto);
        const days = [...new Set((Array.isArray(row.dias) ? row.dias : []).map(String))].sort();
        if (!id || ids.has(id)) throw new Error('Hay una destinataria inválida o repetida.');
        ids.add(id);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Cada trabajadora seleccionada necesita su propio monto mayor que cero.');
        if (!days.length || days.length > 31) throw new Error('Selecciona entre 1 y 31 días trabajados para cada trabajadora.');
        if (days.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + 'T12:00:00')))) {
            throw new Error('Hay una fecha inválida en los días trabajados.');
        }
        return { usuario_id: id, monto: Number(amount.toFixed(2)), dias: days };
    });
}
async function pagarSalariosIndividuales() {
    const pending = pendingSalary();
    let payments, key;
    try {
        payments = pending
            ? validateSalaryRows(pending.payload.map(row => ({ id: row.usuario_id, monto: row.monto, dias: row.dias })))
            : validateSalaryRows(window.seleccionDestinatariosSalario || []);
        key = pending ? pending.key : newIdempotencyKey();
        if (!pending) sessionStorage.setItem('cuevacoin_salary_batch_pending', JSON.stringify({ key, payload: payments }));
    } catch (error) {
        window.showToast(error.message || 'Revisa los datos del salario.', 4500);
        return;
    }

    window.bloquearEdicionSalarioPendiente?.(true);
    window.mostrarCargando();
    try {
        const { data, error } = await window.supabaseClient.rpc('admin_pagar_salarios_individuales', {
            p_pagos: payments,
            p_idempotency_key: key
        });
        if (error) {
            console.error('[CuevaCoin] Pago salarial pendiente de confirmar:', error);
            window.showToast('No se pudo confirmar el resultado. El lote quedó protegido; pulsa «Reintentar el mismo pago». No crees otro pago.', 7000);
            return;
        }
        const rows = Array.isArray(data) ? data : [];
        const ids = new Set(rows.filter(row => row.exitoso === true).map(row => String(row.usuario_id)));
        if (rows.length !== payments.length || payments.some(row => !ids.has(row.usuario_id))) {
            console.error('[CuevaCoin] Respuesta incompleta del lote:', data);
            window.showToast('Resultado incompleto. Conservamos la clave para consultar el mismo lote sin duplicarlo.', 7000);
            return;
        }

        sessionStorage.removeItem('cuevacoin_salary_batch_pending');
        const total = rows.reduce((sum, row) => sum + Number(row.monto || 0), 0);
        window.showToast('Salarios confirmados: ' + rows.length + ' trabajadoras · $' +
            total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 5000);

        rows.forEach(row => {
            const original = payments.find(item => item.usuario_id === String(row.usuario_id));
            const days = (original?.dias || []).map(day => {
                const date = new Date(day + 'T12:00:00');
                return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString('es-ES');
            }).join(', ');
            const message = 'Has recibido un salario de $' + Number(row.monto).toFixed(2) + (days ? ' por los días ' + days : '');
            window.supabaseClient.functions.invoke('enviar-push', {
                body: { usuario_id: row.usuario_id, mensaje: message, tipo_evento: 'pago_admin' }
            }).catch(error => console.error('[CuevaCoin] Error enviando push salarial:', error));
        });

        window.closeModal('pagar-salario-modal');
        window.resetearFormularioSalario?.();
        window.loadAdminUsuarios?.();
        window.cargarHistorialGeneral?.();
        window.loadAdminAuditoria?.();
    } catch (error) {
        console.error('[CuevaCoin] No se pudo confirmar el lote salarial:', error);
        window.showToast('No se pudo confirmar el pago. Reintenta el mismo lote; la clave evita duplicarlo.', 6500);
    } finally {
        window.ocultarCargando();
    }
}
export async function pagarSaldoDesdeAdmin(tipo) {
    if (tipo === 'salario') { await pagarSalariosIndividuales(); return; }

    // Bono: conserva el contrato anterior para no modificar un flujo no solicitado.
    const amount = parseFloat(document.getElementById('bono-monto')?.value);
    const reason = document.getElementById('bono-motivo')?.value || '';
    const original = window.seleccionDestinatariosBono;
    const seen = new Set();
    const recipients = (Array.isArray(original) ? original : []).filter(user => {
        const id = String(user?.id || '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
    if (!(amount > 0)) { window.showToast('El monto debe ser mayor a 0', 3000); return; }
    if (!recipients.length) { window.showToast('Elige al menos una destinataria', 3000); return; }

    window.mostrarCargando();
    try {
        const { data, error } = await window.supabaseClient.rpc('admin_pagar_saldo', {
            p_destinatarios: recipients.map(user => user.id), p_monto: amount, p_motivo: reason, p_tipo: 'bono'
        });
        if (error) throw error;
        const successes = (data || []).filter(row => row.exitoso !== false);
        const failures = (data || []).filter(row => row.exitoso === false);
        if (failures.length) window.showToast('Bono parcial: ' + successes.length + ' correcto(s), ' + failures.length + ' fallido(s). Revisa el historial antes de repetir.', 6500);
        else window.showToast('Bono enviado a ' + successes.length + ' destinataria(s)', 3500);
        (data || []).forEach(row => {
            if (row.exitoso === false) return;
            const message = 'Admin te ha enviado $' + Number(amount).toFixed(2) + ' de bono' + (reason ? ' - Motivo: ' + reason : '');
            window.supabaseClient.functions.invoke('enviar-push', {
                body: { usuario_id: row.usuario_id, mensaje: message, tipo_evento: 'pago_admin' }
            }).catch(error => console.error('[CuevaCoin] Error enviando push del bono:', error));
        });
        window.closeModal('dar-bono-modal');
        document.getElementById('dar-bono-form')?.reset();
        window.seleccionDestinatariosBono = [];
        window.actualizarResumenDestinatarios?.('bono');
        window.loadAdminUsuarios?.();
    } catch (error) {
        console.error('[CuevaCoin] Error al pagar bono:', error);
        window.showToast('Error al enviar el bono. Revisa el historial antes de repetir.', 5000);
    } finally { window.ocultarCargando(); }
}
export function openAjustarSaldoModal(userId) {
    document.getElementById('ajustar-usuario-id').value = userId;
    window.openModal('ajustar-saldo-modal');
}
export function abrirModalPagoSalario() {
    window.openModal('pagar-salario-modal');
    void window.cargarDestinatariasSalario?.();
}
export function abrirModalDarBono() { window.openModal('dar-bono-modal'); }
if (typeof window !== 'undefined') {
    window.pagarSaldoDesdeAdmin = pagarSaldoDesdeAdmin;
    window.openAjustarSaldoModal = openAjustarSaldoModal;
    window.abrirModalPagoSalario = abrirModalPagoSalario;
    window.abrirModalDarBono = abrirModalDarBono;
}
