/**
 * CuevaCoin — js/ui/config-local.js
 * Preferencias de dispositivo: tema, sonido/vibración, tiempo de sesión (Oleada 4).
 * Solo localStorage + DOM; no finanzas.
 */

export function onDarkModeToggleChange(checked) {
    const theme = checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cuevacoin_theme', theme);
    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    if (typeof window !== 'undefined' && typeof window.aplicarColorAcento === 'function') {
        window.aplicarColorAcento((usuarioActual && usuarioActual.colorAcento) || 'rosa');
    }
}

export function onSonidoVibracionToggleChange(checked) {
    localStorage.setItem('cuevacoin_sonido_vibracion', checked ? 'true' : 'false');
}

export function onTiempoSesionChange(value) {
    localStorage.setItem('cuevacoin_tiempo_sesion', value);
}

/**
 * Engancha los listeners de los toggles de Configuración.
 * Idempotente: no duplica si ya se llamó (marca data-cuevacoin-bound).
 */
export function setupLocalConfigListeners() {
    const dark = document.getElementById('dark-mode-toggle');
    if (dark && !dark.dataset.cuevacoinBound) {
        dark.dataset.cuevacoinBound = '1';
        dark.addEventListener('change', function () {
            onDarkModeToggleChange(this.checked);
        });
    }
    const sonido = document.getElementById('sonido-vibracion-toggle');
    if (sonido && !sonido.dataset.cuevacoinBound) {
        sonido.dataset.cuevacoinBound = '1';
        sonido.addEventListener('change', function () {
            onSonidoVibracionToggleChange(this.checked);
        });
    }
    const tiempo = document.getElementById('tiempo-sesion-select');
    if (tiempo && !tiempo.dataset.cuevacoinBound) {
        tiempo.dataset.cuevacoinBound = '1';
        tiempo.addEventListener('change', function () {
            onTiempoSesionChange(this.value);
        });
    }
}

if (typeof window !== 'undefined') {
    window.onDarkModeToggleChange = onDarkModeToggleChange;
    window.onSonidoVibracionToggleChange = onSonidoVibracionToggleChange;
    window.onTiempoSesionChange = onTiempoSesionChange;
    window.setupLocalConfigListeners = setupLocalConfigListeners;
}
