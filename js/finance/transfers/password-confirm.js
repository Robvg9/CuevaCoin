/** Fase 3 / Oleada 4 — Confirmación QR por ID */
export function abrirConfirmarPasswordTransferencia(destinatarioId, destinatarioNombre, cantidad, motivo) {
    transferenciaPendienteQR = { destinatarioId, destinatarioNombre, cantidad, motivo };
    document.getElementById('confirmar-password-qr-monto').textContent =
        'Vas a transferir $' + cantidad.toFixed(2) + ' a ' + String(destinatarioNombre || 'Destinatario') + '.';
    document.getElementById('confirmar-password-qr-input').value = '';
    document.getElementById('confirmar-password-qr-estado').textContent = '';
    window.openModal('confirmar-password-qr-modal');
    document.getElementById('confirmar-password-qr-input').focus();
}
export function cancelarConfirmarPasswordTransferencia() {
    transferenciaPendienteQR = null;
    window.closeModal('confirmar-password-qr-modal');
}
if (typeof window !== 'undefined') {
    window.abrirConfirmarPasswordTransferencia = abrirConfirmarPasswordTransferencia;
    window.cancelarConfirmarPasswordTransferencia = cancelarConfirmarPasswordTransferencia;
}
