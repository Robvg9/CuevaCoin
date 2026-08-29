/** Fase 3 / Oleada 9 — procesarSesionYMostrarPantalla */

export async function procesarSesionYMostrarPantalla() {
    if (!navigator.onLine) {
        const haySesionGuardadaEnDispositivo = Object.keys(localStorage)
            .some((clave) => /^sb-.*-auth-token$/.test(clave));
        if (haySesionGuardadaEnDispositivo && window.entrarModoOfflineConPerfilCacheado()) {
            return;
        }
    }

    let session;
    try {
        const resultado = await window.conTimeoutArranque(window.supabaseClient.auth.getSession(), window.TIMEOUT_RED_ARRANQUE_MS);
        session = resultado.data.session;
    } catch (err) {
        console.error('getSession() falló al arrancar la app:', err);
        if (window.esErrorDeConexion(err) && window.entrarModoOfflineConPerfilCacheado()) {
            return;
        }
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
        window.showLoginScreen();
        return;
    }
    if (session) window.iniciarRelojSesionSiNoExiste();

    if (session) {
        try {
            window.supabaseClient.realtime.setAuth(session.access_token);
            let usuario = await window.conTimeoutArranque(window.obtenerMiPerfilApp(), window.TIMEOUT_RED_ARRANQUE_MS);
            if (!usuario) {
                await new Promise(resolve => setTimeout(resolve, 700));
                usuario = await window.obtenerMiPerfilApp();
            }
            if (!usuario) {
                window.showLoginScreen();
                return;
            }
            usuario = await window.sincronizarVinculacionGoogleSiCorresponde(usuario);
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
                    const { data: { user: usuarioGoogle } } = await window.supabaseClient.auth.getUser();
                    const identidadGoogle = usuarioGoogle?.identities?.find(i => i.provider === 'google');
                    const correoGoogle = identidadGoogle?.identity_data?.email || usuarioGoogle?.email || '';
                    if (typeof window.mostrarCompletarRegistroGoogle === 'function') {
                        window.mostrarCompletarRegistroGoogle(correoGoogle);
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
                window.showLoginScreen();
                return;
            }
            if (window.esErrorDeConexion(err) && window.entrarModoOfflineConPerfilCacheado()) {
                return;
            }
            console.error('DIAGNÓSTICO LOGIN:', err?.message || err, err?.code);
            if (typeof window.ocultarCargando === 'function') window.ocultarCargando();
            if (typeof window.ocultarSplashArranque === 'function') window.ocultarSplashArranque();
            window.showLoginScreen();
            return;
        }
    }
    window.showLoginScreen();
}

if (typeof window !== 'undefined') {
    window.procesarSesionYMostrarPantalla = procesarSesionYMostrarPantalla;
}
