/**
 * CuevaCoin — js/admin/cuenta-desactivada.js
 * Aviso / flag de cuenta desactivada (modo solo lectura) — Oleada 7.
 * No opera finanzas; solo UI + flag global.
 */

export function aplicarEstadoCuentaDesactivada(usuario) {
    const desactivada = !!(usuario && !usuario.esAdmin && usuario.estado === 'inactivo');
    if (typeof window !== 'undefined') {
        window.cuentaDesactivadaGlobal = desactivada;
    }
    if (desactivada && !sessionStorage.getItem('cuevacoin_cuenta_desactivada_visto_sesion')) {
        if (typeof window !== 'undefined' && window.openModal) {
            window.openModal('aviso-cuenta-desactivada-modal');
        }
        sessionStorage.setItem('cuevacoin_cuenta_desactivada_visto_sesion', '1');
    }
}

/**
 * Botón del modal de aviso: lleva a chat de soporte.
 * Depende de helpers de navegación/chat vía window (siguen en legacy).
 */
export function irASoporteDesdeAvisoDesactivada() {
    if (typeof window !== 'undefined' && window.closeModal) {
        window.closeModal('aviso-cuenta-desactivada-modal');
    }
    if (typeof window !== 'undefined' && typeof window.loadSection === 'function') {
        window.loadSection('chat');
    }
    if (typeof window !== 'undefined' && typeof window.cambiarTabChat === 'function') {
        window.cambiarTabChat('user', 'soporte');
    }
}

if (typeof window !== 'undefined') {
    window.aplicarEstadoCuentaDesactivada = aplicarEstadoCuentaDesactivada;
    window.irASoporteDesdeAvisoDesactivada = irASoporteDesdeAvisoDesactivada;
}
