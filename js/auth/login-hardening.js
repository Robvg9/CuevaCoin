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

                const usuarioAEmail = window.usuarioAEmail
                    || ((u) => `${String(u).toLowerCase()}@cuevacoin.local`);

                const { data: authData, error: authError } = await raceTimeout(
                    supabaseClient.auth.signInWithPassword({
                        email: usuarioAEmail(username),
                        password: password
                    }),
                    timeoutMs
                );
                if (authError) throw authError;

                if (authData?.session) {
                    supabaseClient.realtime.setAuth(authData.session.access_token);
                }

                let usuario = await raceTimeout(window.obtenerMiPerfilApp(), timeoutMs);
                if (!usuario) {
                    await new Promise((r) => setTimeout(r, 700));
                    usuario = await raceTimeout(window.obtenerMiPerfilApp(), timeoutMs);
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
                if (typeof window.esErrorDeConexion === 'function' && window.esErrorDeConexion(err) || esTimeout) {
                    if (typeof window.avisarFallaDeConexionPuntual === 'function') {
                        window.avisarFallaDeConexionPuntual();
                    }
                    if (typeof window.showToast === 'function') {
                        window.showToast('No se pudo completar el inicio de sesión. Revisa tu conexión e intenta de nuevo.', 4000);
                    }
                } else if (typeof window.showToast === 'function') {
                    window.showToast('Usuario o contraseña incorrectos', 3000);
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
    window.__cuevacoinLoginHardenedV129 = true;
}
