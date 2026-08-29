/**
 * CuevaCoin — js/core/app.js
 * Arranque, splash, reloj de sesión y pantallas de entrada (Fase 2 / Oleada 1).
 * Comportamiento 1:1 con el monolito original (v125).
 *
 * Incluye solo el esqueleto de arranque / sesión / login screen.
 * NO incluye: showAdminPanel / showUserDashboard completos, logout,
 * procesarSesionYMostrarPantalla (siguen en el monolito por dependencias
 * con paneles, chat, admin y finanzas), ni lógica de retiros/cola.
 *
 * Depende de:
 *   - window.ocultarCargando, window.closeSidebar (utils / monolito)
 *   - window.showAdminPanel, window.showUserDashboard, window.mostrarConexionStrip,
 *     window.actualizarIndicadorColaPendiente (monolito)
 *   - window.esErrorDeConexion (utils)
 */

// ============================================
// TIEMPO DE SESIÓN CONFIGURABLE (F5)
// ============================================
export const DURACION_SESION_MS = { '1h': 3600000, '1d': 86400000, '7d': 604800000 };

export function reiniciarRelojSesion() {
    localStorage.setItem('cuevacoin_sesion_inicio', Date.now().toString());
}

export function iniciarRelojSesionSiNoExiste() {
    if (!localStorage.getItem('cuevacoin_sesion_inicio')) reiniciarRelojSesion();
}

export function sesionExpiradaPorTiempo() {
    const opcion = localStorage.getItem('cuevacoin_tiempo_sesion') || 'nunca';
    const ms = DURACION_SESION_MS[opcion];
    if (!ms) return false;
    const inicio = parseInt(localStorage.getItem('cuevacoin_sesion_inicio') || '0', 10);
    if (!inicio) return false;
    return (Date.now() - inicio) > ms;
}

// ============================================
// SPLASH DE ARRANQUE
// ============================================
export function ocultarSplashArranque() {
    const splash = document.getElementById('arranque-splash');
    if (splash) splash.classList.add('hidden');
}

// ============================================
// PANTALLA DE LOGIN (esqueleto de visibilidad)
// ============================================
export function showLoginScreen() {
    ocultarSplashArranque();
    if (typeof window !== 'undefined' && typeof window.ocultarCargando === 'function') {
        window.ocultarCargando();
    }
    const login = document.getElementById('login-screen');
    if (login) login.classList.remove('hidden');
    const admin = document.getElementById('admin-panel');
    if (admin) admin.classList.add('hidden');
    const userDash = document.getElementById('user-dashboard');
    if (userDash) userDash.classList.add('hidden');
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('hidden');
    const topbar = document.getElementById('app-topbar');
    if (topbar) topbar.classList.add('hidden');
    const googleScreen = document.getElementById('google-vinculacion-screen');
    if (googleScreen) googleScreen.classList.add('hidden');
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    if (typeof window !== 'undefined' && typeof window.closeSidebar === 'function') {
        window.closeSidebar();
    }
}

// ============================================
// DETECCIÓN PWA INSTALADA
// ============================================
export function corriendoComoAppInstalada() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// ============================================
// VERSIÓN DE LA APP (desde Service Worker)
// ============================================
export async function mostrarVersionApp() {
    try {
        const versionEl = document.getElementById('app-version-text');
        if (!versionEl) return;

        const VERSION_FALLBACK = 'V.77';

        const sw = navigator.serviceWorker.controller
            || (await navigator.serviceWorker.ready).active;
        if (!sw) {
            versionEl.textContent = VERSION_FALLBACK;
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
            versionEl.textContent = numero ? `V.${numero}` : version;
        } else {
            versionEl.textContent = VERSION_FALLBACK;
        }
    } catch (err) {
        console.log('No se pudo leer la versión del service worker:', err);
        const versionEl = document.getElementById('app-version-text');
        if (versionEl) versionEl.textContent = 'V.77';
    }
}

// ============================================
// TIMEOUTS DE ARRANQUE
// ============================================
export const TIMEOUT_RED_ARRANQUE_MS = 5000;

export function conTimeoutArranque(promesa, ms) {
    let venceTimeout;
    const timeout = new Promise((_, reject) => {
        venceTimeout = setTimeout(() => reject(new Error('timeout-arranque-app')), ms);
    });
    return Promise.race([promesa, timeout]).finally(() => clearTimeout(venceTimeout));
}

// ============================================
// MODO OFFLINE CON PERFIL CACHEADO
// ============================================
export function entrarModoOfflineConPerfilCacheado() {
    const perfilCacheado = localStorage.getItem('cuevacoin_perfil_cache');
    if (!perfilCacheado) return false;
    try {
        const usuario = JSON.parse(perfilCacheado);
        sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
        if (usuario.esAdmin) {
            if (typeof window !== 'undefined' && typeof window.showAdminPanel === 'function') {
                window.showAdminPanel(usuario);
            }
        } else {
            if (typeof window !== 'undefined' && typeof window.showUserDashboard === 'function') {
                window.showUserDashboard(usuario);
            }
        }
        if (typeof window !== 'undefined' && typeof window.mostrarConexionStrip === 'function') {
            window.mostrarConexionStrip('offline', '📴 Sin conexión — mostrando la última información guardada en este dispositivo', null);
        }
        if (typeof window !== 'undefined' && typeof window.actualizarIndicadorColaPendiente === 'function') {
            window.actualizarIndicadorColaPendiente();
        }
        return true;
    } catch (errCache) {
        console.error('No se pudo usar el perfil cacheado para entrar sin conexión:', errCache);
        return false;
    }
}

// ============================================
// Compatibilidad con el monolito
// ============================================
if (typeof window !== 'undefined') {
    window.DURACION_SESION_MS = DURACION_SESION_MS;
    window.reiniciarRelojSesion = reiniciarRelojSesion;
    window.iniciarRelojSesionSiNoExiste = iniciarRelojSesionSiNoExiste;
    window.sesionExpiradaPorTiempo = sesionExpiradaPorTiempo;
    window.ocultarSplashArranque = ocultarSplashArranque;
    window.showLoginScreen = showLoginScreen;
    window.corriendoComoAppInstalada = corriendoComoAppInstalada;
    window.mostrarVersionApp = mostrarVersionApp;
    window.TIMEOUT_RED_ARRANQUE_MS = TIMEOUT_RED_ARRANQUE_MS;
    window.conTimeoutArranque = conTimeoutArranque;
    window.entrarModoOfflineConPerfilCacheado = entrarModoOfflineConPerfilCacheado;
}
