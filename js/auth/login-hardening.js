/**
 * CuevaCoin — js/auth/login-hardening.js
 * FIX-LOADING (v129): evita overlay "Cargando..." infinito tras login.
 *
 * Causa raíz: el submit de #login-form en legacy-app.js hacía
 * await signInWithPassword / obtenerMiPerfilApp / sincronizarGoogle
 * SIN timeout, y el insert de auditoría admin bloqueaba el finally.
 * Si la red no resolvía, el spinner no se ocultaba nunca.
 *
 * Esta capa re-engancha el submit con timeouts (mismo patrón que
 * procesarSesionYMostrarPantalla) y auditoría en background, sin
 * tocar el monolito completo.
 */
(function hardenLoginForm() {
    function instalar() {
        const form = document.getElementById('login-form');
        if (!form || form.dataset.v129Hardened === '1') return;
        form.dataset.v129Hardened = '1';

        // Captura (true): corre ANTES del handler de legacy-app y lo
        // cancela con stopImmediatePropagation, así solo corre nuestra
        // versión endurecida.
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            e.stopImmediatePropagation();

            const username = (document.getElementById('username')?.value || '').trim();
            const password = document.getElementById('password')?.value || '';

            const mostrar = window.mostrarCargando;
            const ocultar = window.ocultarCargando;
            const splash = window.ocultarSplashArranque;
            if (typeof mostrar === 'function') mostrar();

            const timeoutMs = (typeof window.TIMEOUT_RED_ARRANQUE_MS === 'number')
                ? window.TIMEOUT_RED_ARRANQUE_MS
                : 5000;

            const raceTimeout = (promesa, ms) => {
                if (typeof window.conTimeoutArranque === 'function') {
                    return window.conTimeoutArranque(promesa, ms);
                }
                return Promise.race([
                    promesa,
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-login')), ms))
                ]);
            };

            try {
                const supabaseClient = window.supabaseClient;
                if (!supabaseClient) throw new Error('Supabase no listo');

                const base = window.SUPABASE_URL;
                const publicKey = window.SUPABASE_KEY;
                if (!base || !publicKey) throw new Error('Supabase no listo');

                const response = await raceTimeout(fetch(base + '/functions/v1/cuevacoin-login', {
                    method: 'POST',
                    headers: {
                        apikey: publicKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ identifier: username, password: password }),
                    cache: 'no-store'
                }), Math.max(timeoutMs, 8000));
                const loginPayload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    const error = new Error(loginPayload.error || 'LOGIN_FAILED');
                    error.status = response.status;
                    throw error;
                }
                if (!loginPayload.session?.access_token || !loginPayload.session?.refresh_token) {
                    throw new Error('LOGIN_SESSION_MISSING');
                }

                // The server resolves either perfiles.usuario or perfiles.correo to the
                // internal Auth identity. Supabase still validates the password and
                // the resulting session is installed in the normal browser client.
                const { data: sessionData, error: sessionError } = await raceTimeout(
                    supabaseClient.auth.setSession({
                        access_token: loginPayload.session.access_token,
                        refresh_token: loginPayload.session.refresh_token
                    }),
                    timeoutMs
                );
                if (sessionError) throw sessionError;
                const activeSession = sessionData?.session || loginPayload.session;
                supabaseClient.realtime.setAuth(activeSession.access_token);

                let usuario = await raceTimeout(window.obtenerMiPerfilApp(activeSession.user), timeoutMs);
                if (!usuario) {
                    await new Promise((r) => setTimeout(r, 700));
                    usuario = await raceTimeout(window.obtenerMiPerfilApp(activeSession.user), timeoutMs);
                }
                if (!usuario) {
                    if (typeof window.showToast === 'function') {
                        window.showToast('No se encontró tu perfil. Contacta al administrador.', 4000);
                    }
                    return;
                }

                if (typeof window.sincronizarVinculacionGoogleSiCorresponde === 'function') {
                    usuario = await raceTimeout(
                        window.sincronizarVinculacionGoogleSiCorresponde(usuario),
                        timeoutMs
                    );
                }

                if (!usuario.esAdmin && usuario.estado === 'archivado') {
                    try {
                        const { error: signOutError } = await supabaseClient.auth.signOut();
                        if (signOutError) console.error('No se pudo cerrar la sesión archivada:', signOutError);
                    } catch (signOutError) {
                        console.error('No se pudo cerrar la sesión archivada:', signOutError);
                    }
                    localStorage.removeItem('cuevacoin_perfil_cache');
                    localStorage.removeItem('cuevacoin_sesion_inicio');
                    sessionStorage.removeItem('cuevacoin_usuario_actual');
                    if (typeof window.showToast === 'function') {
                        window.showToast('Esta cuenta está archivada y no puede acceder a CuevaCoin. Contacta al administrador.', 5000);
                    }
                    return;
                }

                if (!usuario.googleVinculado) {
                    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
                    if (typeof window.mostrarBloqueoVerificacionGoogle === 'function') {
                        window.mostrarBloqueoVerificacionGoogle(usuario);
                    }
                    return;
                }

                sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
                if (typeof window.reiniciarRelojSesion === 'function') window.reiniciarRelojSesion();

                if (usuario.esAdmin) {
                    if (typeof window.showAdminPanel === 'function') window.showAdminPanel(usuario);
                    // Auditoría en background: no bloquea ocultarCargando
                    supabaseClient
                        .from('auditoria')
                        .insert({
                            usuario_id: usuario.id,
                            usuario_nombre: usuario.nombre || usuario.usuario,
                            accion: 'Iniciar sesión (Admin)'
                        })
                        .then(({ error }) => { if (error) console.error(error); })
                        .catch((err) => console.error(err));
                } else {
                    if (typeof window.showUserDashboard === 'function') window.showUserDashboard(usuario);
                }

                if (window.recargaSwPendiente) {
                    window.location.reload();
                    return;
                }
            } catch (err) {
                console.error(err);
                const esTimeout = /timeout/i.test(String(err?.message || err));
                if (err?.status === 429) {
                    if (typeof window.showToast === 'function') window.showToast('Demasiados intentos. Espera unos minutos e inténtalo otra vez.', 4500);
                } else if (err?.status === 503 || /LOGIN_SERVICE_UNAVAILABLE/.test(String(err?.message || ''))) {
                    if (typeof window.showToast === 'function') window.showToast('El servicio de inicio de sesión no está disponible ahora. Inténtalo de nuevo en unos minutos.', 4500);
                } else if ((typeof window.esErrorDeConexion === 'function' && window.esErrorDeConexion(err)) || esTimeout) {
                    if (typeof window.avisarFallaDeConexionPuntual === 'function') window.avisarFallaDeConexionPuntual();
                    if (typeof window.showToast === 'function') window.showToast('No se pudo completar el inicio de sesión. Revisa tu conexión e intenta de nuevo.', 4000);
                } else if (typeof window.showToast === 'function') {
                    window.showToast('Usuario o correo, contraseña o estado de la cuenta incorrectos. Si tu cuenta se creó con Google, utiliza el botón de Google.', 4500);
                }
            } finally {
                if (typeof ocultar === 'function') ocultar();
                if (typeof splash === 'function') splash();
            }
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(instalar, 0));
    } else {
        setTimeout(instalar, 0);
    }
    // Reintento tras carga de legacy-app (defer)
    window.addEventListener('load', () => setTimeout(instalar, 50));
})();

if (typeof window !== 'undefined') {
    window.__cuevacoinLoginHardenedV143 = true;
}
