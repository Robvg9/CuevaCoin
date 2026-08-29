/**
 * CuevaCoin — js/core/connection-guard.js
 * Guard de conexión / cuenta desactivada (Oleada 5).
 * No ejecuta operaciones financieras; solo bloquea si no hay red o la cuenta está desactivada.
 */

export function requiereConexionParaOperar() {
    // F8 (2026-08-07): modo solo lectura. Se chequea primero porque
    // no depende de la conexión - una cuenta desactivada no puede
    // operar ni online ni offline.
    const desactivada = (typeof window !== 'undefined') ? window.cuentaDesactivadaGlobal : false;
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};

    if (desactivada) {
        toast('❌ Tu cuenta está desactivada. Contacta a soporte para más información.', 3500);
        return false;
    }
    if (!navigator.onLine) {
        toast('❌ No se puede realizar esta operación por falta de Internet', 3500);
        return false;
    }
    return true;
}

if (typeof window !== 'undefined') {
    window.requiereConexionParaOperar = requiereConexionParaOperar;
}
