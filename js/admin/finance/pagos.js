/** Fase 3 / Oleada 8 — Pagos admin / modales */

export async function pagarSaldoDesdeAdmin(tipo) {
    const esBono = tipo === 'bono';
    const idModal = esBono ? 'dar-bono-modal' : 'pagar-salario-modal';
    const idForm = esBono ? 'dar-bono-form' : 'pagar-salario-form';
    const monto = parseFloat(document.getElementById(esBono ? 'bono-monto' : 'salario-monto').value);
    const motivo = document.getElementById(esBono ? 'bono-motivo' : 'salario-motivo').value;
    const seleccion = esBono ? window.seleccionDestinatariosBono : window.seleccionDestinatariosSalario;

    if (!(monto > 0)) {
        window.showToast('El monto debe ser mayor a 0', 3000);
        return;
    }
    if (seleccion.length === 0) {
        window.showToast('Elige al menos una destinataria', 3000);
        return;
    }

    window.mostrarCargando();
    try {
        console.log(`[ADMIN_PAGO_DEBUG] Iniciando pago ${tipo} a ${seleccion.length} destinatarios, monto: ${monto}`);
        
        const { data, error } = await window.supabaseClient.rpc('admin_pagar_saldo', {
            p_destinatarios: seleccion.map(u => u.id),
            p_monto: monto,
            p_motivo: motivo,
            p_tipo: tipo
        });

        if (error) {
            console.error('[ADMIN_PAGO_DEBUG] Error en admin_pagar_saldo:', error);
            console.error('[ADMIN_PAGO_DEBUG] Detalles:', JSON.stringify(error, null, 2));
            
            // Mejor manejo de errores según tipo
            if (error.message && error.message.includes('no es admin')) {
                window.showToast('Solo el admin puede realizar pagos', 4000);
            } else if (error.message && error.message.includes('saldo insuficiente')) {
                window.showToast('El admin no tiene saldo suficiente para cubrir este pago', 4000);
            } else {
                window.showToast(esBono ? 'Error al enviar el bono. Ver consola para detalles.' : 'Error al pagar el salario. Ver consola para detalles.', 5000);
            }
            return;
        }

        console.log(`[ADMIN_PAGO_DEBUG] Pago exitoso, resultados:`, data);
        
        // Aviso push a cada destinataria (mismo patrón que
        // solicitud de retiro / mensaje de chat / window.sendUserMessage).
        const mensajePush = `Admin te ha enviado $${monto.toFixed(2)}${esBono ? ' de bono' : ' de salario'}${motivo ? ' - Motivo: ' + motivo : ''}`;
        
        const exitosos = (data || []).filter(f => f.exitoso !== false);
        const fallidos = (data || []).filter(f => f.exitoso === false);
        
        console.log(`[ADMIN_PAGO_DEBUG] Exitosos: ${exitosos.length}, Fallidos: ${fallidos.length}`);
        
        if (fallidos.length > 0) {
            console.warn('[ADMIN_PAGO_DEBUG] Destinatarios fallidos:', fallidos);
            window.showToast(`Pago parcial: ${exitosos.length} correcto(s), ${fallidos.length} fallido(s). Revisa el historial antes de repetir la operación.`, 6500);
        } else {
            window.showToast(`${esBono ? 'Bono' : 'Salario'} enviado a ${exitosos.length} destinataria(s)`, 3000);
        }
        
        (data || []).forEach(fila => {
            if (fila.exitoso !== false) {
                window.supabaseClient.functions.invoke('enviar-push', {
                    body: { usuario_id: fila.usuario_id, mensaje: mensajePush, tipo_evento: 'pago_admin' }
                }).catch((err) => console.error('[ADMIN_PAGO_DEBUG] Error mandando push de pago:', err));
            }
        });

        // No sobrescribir aquí el aviso anterior: puede informar que hubo
        // resultados parciales y exige revisar qué trabajadoras fallaron.
        window.closeModal(idModal);
        document.getElementById(idForm).reset();
        if (esBono) {
            window.seleccionDestinatariosBono = [];
            window.actualizarResumenDestinatarios('bono');
        } else {
            window.seleccionDestinatariosSalario = [];
            window.actualizarResumenDestinatarios('salario');
        }
        window.loadAdminUsuarios();
    } catch (error) {
        console.error(error);
        window.showToast(esBono ? 'Error al enviar el bono' : 'Error al pagar el salario', 3500);
    } finally {
        window.ocultarCargando();
    }
}

export function openAjustarSaldoModal(usuarioId) {
    document.getElementById('ajustar-usuario-id').value = usuarioId;
    window.openModal('ajustar-saldo-modal');
}

export function abrirModalPagoSalario() {
    window.openModal('pagar-salario-modal');
}

export function abrirModalDarBono() {
    window.openModal('dar-bono-modal');
}

if (typeof window !== 'undefined') {
    window.pagarSaldoDesdeAdmin = pagarSaldoDesdeAdmin;
    window.openAjustarSaldoModal = openAjustarSaldoModal;
    window.abrirModalPagoSalario = abrirModalPagoSalario;
    window.abrirModalDarBono = abrirModalDarBono;
}
