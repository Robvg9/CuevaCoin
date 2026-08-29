/** Fase 3 / Oleada 4 — abrirModalTransaccional */

export function abrirModalTransaccional(modalId) {
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    if (usuario && !usuario.esAdmin && !usuario.perfilCompleto) {
        window.openModal('perfil-incompleto-modal');
        return;
    }
    window.openModal(modalId);
    // F1 (v63): refrescar los chips de favoritos cada vez que se abre
    // Transferir, para que reflejen lo marcado/desmarcado en el historial.
    if (modalId === 'transferir-modal') {
        window.cargarChipsFavoritos();
        // Reautenticación QR (2026-08-08): cada apertura "de cero" del
        // modal empieza sin destinatario cargado por QR todavía.
        window.transferenciaViaQR = false;
    }
}

if (typeof window !== 'undefined') {
    window.abrirModalTransaccional = abrirModalTransaccional;
}
