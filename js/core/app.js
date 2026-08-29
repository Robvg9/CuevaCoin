/**
 * CuevaCoin — js/core/app.js
 * Arranque, versión, timeouts y modo offline con perfil cacheado.
 */

export function reiniciarRelojSesion() {
    localStorage.setItem('cuevacoin_sesion_inicio', Date.now().toString());
}

export function iniciarRelojSesionSiNoExiste() {
    if (!localStorage.getItem('cuevacoin_sesion_inicio')) reiniciarRelojSesion();
}

export function sesionExpiradaPorTiempo() {
    const opcion = localStorage.getItem('cuevacoin_tiempo_sesion') || 'nunca';
    if (opcion === 'nunca') return false;
    const limites = { '1h': 3600000, '1d': 86400000, '7d': 604800000 };
    const maxMs = limites[opcion];
    if (!maxMs) return false;
    const inicio = parseInt(localStorage.getItem('cuevacoin_sesion_inicio') || '0', 10);
    if (!inicio) return false;
    return (Date.now() - inicio) > maxMs;
}

export function showLoginScreen() {
    if (typeof window !== 'undefined' && typeof window.ocultarSplashArranque === 'function') {
        window.ocultarSplashArranque();
    }
    if (typeof window !== 'undefined' && typeof window.ocultarCargando === 'function') {
        window.ocultarCargando();
    }
    const login = document.getElementById('login-screen');
    const admin = document.getElementById('admin-panel');
    const user = document.getElementById('user-dashboard');
    const sidebar = document.getElementById('sidebar');
    const topbar = document.getElementById('app-topbar');
    const google = document.getElementById('google-vinculacion-screen');
    if (login) login.classList.remove('hidden');
    if (admin) admin.classList.add('hidden');
    if (user) user.classList.add('hidden');
    if (sidebar) sidebar.classList.add('hidden');
    if (topbar) topbar.classList.add('hidden');
    if (google) google.classList.add('hidden');
    if (typeof window !== 'undefined' && typeof window.mostrarVersionApp === 'function') {
        window.mostrarVersionApp();
    }
}

export async function mostrarVersionApp() {
    // Fuente única de verdad: CACHE_NAME del Service Worker (GET_VERSION).
    // Actualiza TODOS los elementos .js-app-version y #app-version-text
    // (login + página principal autenticada).
    const els = Array.from(document.querySelectorAll('#app-version-text, .js-app-version'));
    if (els.length === 0) return;

    const VERSION_FALLBACK = 'V.130';
    const aplicar = (texto) => { els.forEach((el) => { el.textContent = texto; }); };

    try {
        const sw = navigator.serviceWorker.controller
            || (await navigator.serviceWorker.ready).active;
        if (!sw) {
            aplicar(VERSION_FALLBACK);
            return;
        }

        const version = await new Promise((resolve, reject) => {
            const canal = new MessageChannel();
            const timeoutId = setTimeout(() => reject(new Error('timeout')), 3000);
            canal.port1.onmessage = (event) => {
                clearTimeout(timeoutId);
                resolve(event.data?.version);
            };
            sw.postMessage({ type: 'GET_VERSION' }, [canal.port2]);
        });

        if (version) {
            const numero = version.match(/v(\d+)$/i)?.[1];
            aplicar(numero ? `V.${numero}` : version);
        } else {
            aplicar(VERSION_FALLBACK);
        }
    } catch (err) {
        console.log('No se pudo leer la versión del service worker:', err);
        aplicar(VERSION_FALLBACK);
    }
}

export const TIMEOUT_RED_ARRANQUE_MS = 5000;

export function conTimeoutArranque(promesa, ms) {
    let venceTimeout;
    const timeout = new Promise((_, reject) => {
        venceTimeout = setTimeout(() => reject(new Error('timeout-arranque')), ms || TIMEOUT_RED_ARRANQUE_MS);
    });
    return Promise.race([promesa, timeout]).finally(() => clearTimeout(venceTimeout));
}

export function entrarModoOfflineConPerfilCacheado() {
    try {
        const perfilCacheado = localStorage.getItem('cuevacoin_perfil_cache');
        if (!perfilCacheado) return false;
        const usuario = JSON.parse(perfilCacheado);
        if (!usuario || !usuario.id) return false;
        sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
        if (typeof window.entrarSegunVerificacionGoogle === 'function') {
            window.entrarSegunVerificacionGoogle(usuario);
        } else if (usuario.esAdmin && typeof window.showAdminPanel === 'function') {
            window.showAdminPanel(usuario);
        } else if (typeof window.showUserDashboard === 'function') {
            window.showUserDashboard(usuario);
        }
        if (typeof window.mostrarConexionStrip === 'function') {
            window.mostrarConexionStrip('offline', '📴 Sin conexión — mostrando datos guardados');
        }
        return true;
    } catch (err) {
        console.error('No se pudo entrar en modo offline con perfil cacheado:', err);
        return false;
    }
}

if (typeof window !== 'undefined') {
    window.reiniciarRelojSesion = reiniciarRelojSesion;
    window.iniciarRelojSesionSiNoExiste = iniciarRelojSesionSiNoExiste;
    window.sesionExpiradaPorTiempo = sesionExpiradaPorTiempo;
    window.showLoginScreen = showLoginScreen;
    window.mostrarVersionApp = mostrarVersionApp;
    window.TIMEOUT_RED_ARRANQUE_MS = TIMEOUT_RED_ARRANQUE_MS;
    window.conTimeoutArranque = conTimeoutArranque;
    window.entrarModoOfflineConPerfilCacheado = entrarModoOfflineConPerfilCacheado;
}
