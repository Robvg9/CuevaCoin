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
// ACTUALIZAR APP / LIMPIAR CACHÉ (v130)
// ============================================
// Solo Cache Storage + Service Worker. NO borra localStorage
// (sb-*-auth-token, cuevacoin_cola_pendiente, perfil cache, preferencias)
// ni sessionStorage de sesión.

export function asegurarUiVersionYActualizar() {
    // Topbar: insertar .js-app-version si el HTML viejo no lo trae
    const topbarUser = document.getElementById('topbar-user');
    if (topbarUser && !document.querySelector('#app-topbar .js-app-version')) {
        const span = document.createElement('span');
        span.className = 'js-app-version';
        span.setAttribute('title', 'Versión de CuevaCoin');
        span.style.cssText = 'font-size:11px;opacity:0.7;font-family:sans-serif;margin-right:8px;white-space:nowrap;font-weight:500;letter-spacing:0.02em;';
        topbarUser.insertAdjacentElement('afterend', span);
    }
    // Login version class
    const loginVer = document.getElementById('app-version-text');
    if (loginVer && !loginVer.classList.contains('js-app-version')) {
        loginVer.classList.add('js-app-version');
    }
    // Configuración > card Actualizar (si falta en HTML)
    const sesionCardBtn = document.querySelector('#shared-config-cambio-contrasena .btn-danger');
    if (sesionCardBtn && !document.getElementById('btn-actualizar-app-config')) {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = '<h2>🔄 Actualizar aplicación</h2>' +
            '<p style="opacity:0.8;margin-bottom:14px;">Si la app se ve desactualizada o algo no carga bien, actualiza CuevaCoin desde acá. Se limpia la caché y se recarga la versión más reciente. Tu sesión y operaciones pendientes se conservan.</p>' +
            '<button type="button" id="btn-actualizar-app-config" class="btn btn-secondary" style="width:100%;" onclick="solicitarActualizarApp()">🔄 Actualizar app / Limpiar caché</button>' +
            '<p class="js-app-version" style="font-size:11px;opacity:0.55;margin-top:10px;text-align:center;font-family:sans-serif;"></p>';
        const sesionCard = sesionCardBtn.closest('.card');
        if (sesionCard && sesionCard.parentNode) {
            sesionCard.parentNode.insertBefore(card, sesionCard.nextSibling);
        }
    }
    // Modal de confirmación
    if (!document.getElementById('actualizar-app-modal')) {
        const modal = document.createElement('div');
        modal.id = 'actualizar-app-modal';
        modal.className = 'modal';
        modal.innerHTML = '<div class="modal-content" style="max-width:420px;text-align:center;">' +
            '<span class="close" onclick="closeModal(\'actualizar-app-modal\')">&times;</span>' +
            '<div style="font-size:40px;margin-bottom:8px;">🔄</div>' +
            '<h2 style="margin-bottom:8px;">Actualizar CuevaCoin</h2>' +
            '<p style="margin-bottom:20px;opacity:0.85;line-height:1.5;">Se actualizará CuevaCoin y se limpiará la caché local. La aplicación se recargará con la versión más reciente.</p>' +
            '<p style="font-size:12px;opacity:0.65;margin-bottom:18px;">Tu sesión y las operaciones pendientes de sincronizar se conservan.</p>' +
            '<div style="display:flex;gap:12px;justify-content:center;">' +
            '<button type="button" class="btn" style="flex:1;" onclick="closeModal(\'actualizar-app-modal\')">Cancelar</button>' +
            '<button type="button" id="btn-actualizar-app-confirmar" class="btn btn-primary" style="flex:1;" onclick="limpiarCacheYActualizar()">Actualizar ahora</button>' +
            '</div></div>';
        document.body.appendChild(modal);
    }
}

export function solicitarActualizarApp() {
    if (window.__cuevacoinActualizandoApp) return;
    asegurarUiVersionYActualizar();
    if (typeof window.openModal === 'function') {
        window.openModal('actualizar-app-modal');
    } else {
        const ok = window.confirm('Se actualizará CuevaCoin y se limpiará la caché local. La aplicación se recargará con la versión más reciente.');
        if (ok) limpiarCacheYActualizar();
    }
}

export async function limpiarCacheYActualizar() {
    if (window.__cuevacoinActualizandoApp) return;
    window.__cuevacoinActualizandoApp = true;

    const botones = [
        document.getElementById('btn-limpiar-cache'),
        document.getElementById('btn-actualizar-app-config'),
        document.getElementById('btn-actualizar-app-confirmar')
    ].filter(Boolean);
    const textosPrevios = botones.map((b) => b.textContent);
    botones.forEach((b) => { b.disabled = true; b.textContent = 'Actualizando…'; });

    if (typeof window.closeModal === 'function') {
        try { window.closeModal('actualizar-app-modal'); } catch (e) {}
    }
    if (typeof window.mostrarCargando === 'function') {
        try { window.mostrarCargando(); } catch (e) {}
    }

    const conTimeout = (promesa, ms, etiqueta) => Promise.race([
        promesa,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-' + etiqueta)), ms))
    ]);

    let errorMsg = null;
    try {
        if (window.caches) {
            const nombres = await conTimeout(caches.keys(), 8000, 'caches-keys');
            await conTimeout(
                Promise.all(nombres.map((n) => caches.delete(n).catch(() => false))),
                12000,
                'caches-delete'
            );
        }
        if ('serviceWorker' in navigator) {
            try {
                const regs = await conTimeout(navigator.serviceWorker.getRegistrations(), 6000, 'sw-regs');
                for (const reg of regs) {
                    try {
                        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                        await conTimeout(reg.update(), 8000, 'sw-update').catch(() => null);
                    } catch (e) {}
                }
                await conTimeout(
                    Promise.all(regs.map((r) => r.unregister().catch(() => false))),
                    8000,
                    'sw-unregister'
                );
            } catch (errSw) {
                console.warn('SW update/unregister:', errSw);
                errorMsg = (errorMsg ? errorMsg + ' · ' : '') + 'Service Worker: ' + (errSw.message || errSw);
            }
        }
    } catch (err) {
        console.warn('Error al limpiar caché/Service Worker:', err);
        errorMsg = (err && err.message) ? String(err.message) : String(err);
    }

    try {
        const url = new URL(window.location.href);
        url.searchParams.set('_cc', String(Date.now()));
        window.location.replace(url.toString());
    } catch (e) {
        window.location.reload();
    }

    setTimeout(() => {
        window.__cuevacoinActualizandoApp = false;
        botones.forEach((b, i) => {
            b.disabled = false;
            b.textContent = textosPrevios[i] || '🔄 Actualizar app / Limpiar caché';
        });
        if (typeof window.ocultarCargando === 'function') window.ocultarCargando();
        if (errorMsg && typeof window.showToast === 'function') {
            window.showToast('No se pudo completar la actualización: ' + errorMsg + '. Intenta de nuevo.', 5000);
        }
    }, 12000);
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
    window.asegurarUiVersionYActualizar = asegurarUiVersionYActualizar;
    window.solicitarActualizarApp = solicitarActualizarApp;
    window.limpiarCacheYActualizar = limpiarCacheYActualizar;
    // Inyectar UI (topbar version + botón Config) en cuanto el DOM esté listo
    const bootUi = () => {
        try {
            asegurarUiVersionYActualizar();
            mostrarVersionApp();
        } catch (e) { console.warn(e); }
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(bootUi, 0));
    } else {
        setTimeout(bootUi, 0);
    }
    window.addEventListener('load', () => setTimeout(bootUi, 100));
}
