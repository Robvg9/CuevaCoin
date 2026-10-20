/** Fase 3 / Oleada 9 — procesarSesionYMostrarPantalla
 * FIX-LOADING (v129): todos los awaits de red van con conTimeoutArranque;
 * early-returns limpian overlay; sincronizarGoogle también con timeout.
 */

export async function procesarSesionYMostrarPantalla() {
    const limpiarOverlays = () => {
        if (typeof window.ocultarCargando === 'function') window.ocultarCargando();
        if (typeof window.ocultarSplashArranque === 'function') window.ocultarSplashArranque();
    };

    // Recovery magic links create an Auth session for the verified contact mailbox.
    // Never route that temporary session through the normal profile/dashboard bootstrap.
    const recoveryParams = new URLSearchParams(window.location.search || '');
    if (recoveryParams.get('cc_recovery') === '1') {
        limpiarOverlays();
        if (typeof window.showLoginScreen === 'function') window.showLoginScreen();
        if (typeof window.abrirRecuperacionPorEnlace === 'function') {
            window.abrirRecuperacionPorEnlace();
        }
        return;
    }

    if (!navigator.onLine) {
        const haySesionGuardadaEnDispositivo = Object.keys(localStorage)
            .some((clave) => /^sb-.*-auth-token$/.test(clave));
        if (haySesionGuardadaEnDispositivo && window.entrarModoOfflineConPerfilCacheado()) {
            return;
        }
    }

    let session;
    try {
        const resultado = await window.conTimeoutArranque(
            window.supabaseClient.auth.getSession(),
            window.TIMEOUT_RED_ARRANQUE_MS
        );
        session = resultado.data.session;
    } catch (err) {
        console.error('getSession() falló al arrancar la app:', err);
        if (await window.esFalloDeConexionConfirmado(err) && window.entrarModoOfflineConPerfilCacheado()) {
            return;
        }
        limpiarOverlays();
        window.showLoginScreen();
        return;
    }

    const loginScreen = document.getElementById('login-screen');
    if (session && loginScreen) {
        loginScreen.classList.add('hidden');
    }

    if (session && window.sesionExpiradaPorTiempo()) {
        try {
            await window.supabaseClient.auth.signOut();
        } catch (err) {
            console.error('No se pudo cerrar la sesión vencida:', err);
        }
        localStorage.removeItem('cuevacoin_sesion_inicio');
        limpiarOverlays();
        window.showLoginScreen();
        return;
    }
    if (session) window.iniciarRelojSesionSiNoExiste();

    if (session) {
        try {
            window.supabaseClient.realtime.setAuth(session.access_token);
            let usuario = await window.conTimeoutArranque(
                window.obtenerMiPerfilApp(session.user),
                window.TIMEOUT_RED_ARRANQUE_MS
            );
            if (!usuario) {
                await new Promise(resolve => setTimeout(resolve, 700));
                usuario = await window.conTimeoutArranque(
                    window.obtenerMiPerfilApp(session.user),
                    window.TIMEOUT_RED_ARRANQUE_MS
                );
            }
            if (!usuario) {
                limpiarOverlays();
                window.showLoginScreen();
                return;
            }
            if (!usuario.esAdmin && usuario.estado === 'archivado') {
                try {
                    const { error: signOutError } = await window.supabaseClient.auth.signOut();
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
                limpiarOverlays();
                window.showLoginScreen();
                return;
            }

            if (typeof window.sincronizarVinculacionGoogleSiCorresponde === 'function') {
                usuario = await window.conTimeoutArranque(
                    window.sincronizarVinculacionGoogleSiCorresponde(usuario),
                    window.TIMEOUT_RED_ARRANQUE_MS
                );
            }
            if (localStorage.getItem('cuevacoin_google_flujo') === 'signup') {
                window.showToast('Ya tenías una cuenta creada con este correo de Google — te iniciamos sesión en ella.', 5000);
            }
            localStorage.removeItem('cuevacoin_google_flujo');
            sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
            window.entrarSegunVerificacionGoogle(usuario);
            if (typeof window.actualizarIndicadorColaPendiente === 'function') window.actualizarIndicadorColaPendiente();
            if (typeof window.sincronizarColaPendiente === 'function') window.sincronizarColaPendiente();
            return;
        } catch (err) {
            console.error(err);
            if (err?.code === 'PGRST116') {
                const flujoGoogle = localStorage.getItem('cuevacoin_google_flujo');
                if (flujoGoogle === 'signup') {
                    try {
                        const { data: { user: usuarioGoogle } } = await window.conTimeoutArranque(
                            window.supabaseClient.auth.getUser(),
                            window.TIMEOUT_RED_ARRANQUE_MS
                        );
                        const identidadGoogle = usuarioGoogle?.identities?.find(i => i.provider === 'google');
                        const correoGoogle = identidadGoogle?.identity_data?.email || usuarioGoogle?.email || '';
                        if (typeof window.mostrarCompletarRegistroGoogle === 'function') {
                            window.mostrarCompletarRegistroGoogle(correoGoogle);
                        }
                    } catch (e) {
                        console.error(e);
                        limpiarOverlays();
                        window.showLoginScreen();
                    }
                    return;
                }
                try {
                    await window.supabaseClient.functions.invoke('abandonar-cuenta-google-sin-perfil');
                } catch (errLimpieza) {
                    console.error('No se pudo autolimpiar la cuenta de Google sin perfil:', errLimpieza);
                }
                try {
                    await window.supabaseClient.auth.signOut();
                } catch (errSignOut) {
                    console.error('No se pudo cerrar la sesión sin perfil:', errSignOut);
                }
                localStorage.removeItem('cuevacoin_google_flujo');
                window.showToast('Esta cuenta de Google no está vinculada a ningún usuario de CuevaCoin. Inicia sesión con tu usuario y contraseña para vincularla.', 5000);
                limpiarOverlays();
                window.showLoginScreen();
                return;
            }
            if (await window.esFalloDeConexionConfirmado(err) && window.entrarModoOfflineConPerfilCacheado()) {
                return;
            }
            console.error('DIAGNÓSTICO LOGIN:', err?.message || err, err?.code);
            limpiarOverlays();
            window.showLoginScreen();
            return;
        }
    }
    limpiarOverlays();
    window.showLoginScreen();
}

if (typeof window !== 'undefined') {
    window.procesarSesionYMostrarPantalla = procesarSesionYMostrarPantalla;
}
