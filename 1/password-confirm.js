/** Fase 3 / Oleada 4 — Confirm password transferencia */

export function abrirConfirmarPasswordTransferencia(destinatarioCorreo, cantidad, motivo) {
    transferenciaPendienteQR = { destinatarioCorreo, cantidad, motivo };
    document.getElementById('confirmar-password-qr-monto').textContent =
        `Vas a transferir $${cantidad.toFixed(2)} a ${destinatarioCorreo}.`;
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
