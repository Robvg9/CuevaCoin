/**
 * CuevaCoin — js/ui/connection-strip.js
 * Franja visual de estado de conexión (Fase 3 / Oleada 2).
 * NO incluye actualizarIndicadorColaPendiente ni sincronizarColaPendiente (cola offline).
 */

function _getTimeoutRef() {
    return (typeof window !== 'undefined') ? window.conexionStripOcultarTimeout : null;
}
function _setTimeoutRef(v) {
    if (typeof window !== 'undefined') window.conexionStripOcultarTimeout = v;
}

export function actualizarAltoConexionStrip() {
    const strip = document.getElementById('conexion-strip');
    if (!strip) return;
    const visible = strip.classList.contains('conexion-strip--visible');
    const alto = visible ? strip.offsetHeight : 0;
    document.documentElement.style.setProperty('--conexion-strip-alto', alto + 'px');
}

export function mostrarConexionStrip(estado, mensaje, autoOcultarMs) {
    const strip = document.getElementById('conexion-strip');
    const texto = document.getElementById('conexion-strip-texto');
    if (!strip || !texto) return;
    clearTimeout(_getTimeoutRef());
    strip.classList.remove('conexion-strip--offline', 'conexion-strip--online');
    strip.classList.add(estado === 'online' ? 'conexion-strip--online' : 'conexion-strip--offline');
    texto.textContent = mensaje;
    strip.classList.add('conexion-strip--visible');
    requestAnimationFrame(actualizarAltoConexionStrip);
    if (autoOcultarMs) {
        _setTimeoutRef(setTimeout(() => {
            strip.classList.remove('conexion-strip--visible');
            actualizarAltoConexionStrip();
        }, autoOcultarMs));
    }
}

export function ocultarConexionStrip() {
    const strip = document.getElementById('conexion-strip');
    if (!strip) return;
    clearTimeout(_getTimeoutRef());
    strip.classList.remove('conexion-strip--visible');
    actualizarAltoConexionStrip();
}

export function avisarFallaDeConexionPuntual() {
    mostrarConexionStrip('offline', '📡❌ No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.', 4000);
}

/** Comprobación rápida de salida real a internet (no solo navigator.onLine). */
export async function hayConexionRealAhora() {
    if (!navigator.onLine) return false;
    try {
        const controlador = new AbortController();
        const venceTimeout = setTimeout(() => controlador.abort(), 2500);
        const base = (typeof window !== 'undefined' && window.SUPABASE_URL)
            ? window.SUPABASE_URL
            : '';
        if (!base) {
            clearTimeout(venceTimeout);
            return navigator.onLine;
        }
        await fetch(base + '/auth/v1/health', {
            method: 'GET',
            mode: 'no-cors',
            cache: 'no-store',
            signal: controlador.signal,
        });
        clearTimeout(venceTimeout);
        return true;
    } catch (err) {
        return false;
    }
}

if (typeof window !== 'undefined') {
    window.actualizarAltoConexionStrip = actualizarAltoConexionStrip;
    window.mostrarConexionStrip = mostrarConexionStrip;
    window.ocultarConexionStrip = ocultarConexionStrip;
    window.avisarFallaDeConexionPuntual = avisarFallaDeConexionPuntual;
    window.hayConexionRealAhora = hayConexionRealAhora;
    window.addEventListener('resize', actualizarAltoConexionStrip);
}
