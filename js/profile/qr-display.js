/**
 * CuevaCoin — js/profile/qr-display.js
 * QR propio de identificación (número de cuenta). Oleada 3.
 * NO incluye escáner ni prellenado de transferencias.
 */

export function renderizarMiCodigoQR() {
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    if (!usuario) return;
    if (!usuario.numeroCuenta) {
        toast('Todavía no tienes número de cuenta asignado', 3000);
        return;
    }
    if (typeof QRCode === 'undefined') {
        toast('No se pudo generar el código QR', 3000);
        return;
    }

    const contenedor = document.getElementById('mi-qr-canvas');
    if (!contenedor) return;
    contenedor.innerHTML = '';
    const instancia = new QRCode(contenedor, {
        text: `CUEVACOIN:${usuario.numeroCuenta}`,
        width: 180,
        height: 180,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });
    if (typeof window !== 'undefined') {
        window.miQRInstancia = instancia;
    }

    const nombreEl = document.getElementById('mi-qr-nombre');
    const cuentaEl = document.getElementById('mi-qr-cuenta');
    if (nombreEl) nombreEl.textContent = usuario.nombre || usuario.usuario;
    if (cuentaEl) cuentaEl.textContent = `Cuenta: ${usuario.numeroCuenta}`;
}

if (typeof window !== 'undefined') {
    window.renderizarMiCodigoQR = renderizarMiCodigoQR;
}
