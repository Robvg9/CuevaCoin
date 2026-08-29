/** Fase 3 / Oleada 9 — procesarSesionYMostrarPantalla */

export async function procesarSesionYMostrarPantalla() {
    // FIX-VELOCIDAD (2026-08-09): antes, incluso con
    // navigator.onLine=false (el navegador YA sabe que no hay
    // conexión, ej. modo avión), esta función igual arrancaba
    // llamando a getSession() - si el token de acceso estaba
    // vencido, supabase-js intentaba renovarlo solo contra el
    // servidor, y esa llamada podía tardar varios segundos en
    // fallar antes de recién ahí caer al modo offline. Eso era la
    // causa real de que "tardara mucho en entrar sin conexión".
    // Ahora, si el navegador ya reporta sin conexión Y hay tanto un
    // perfil cacheado como una sesión guardada en este dispositivo
    // (se chequea la clave de localStorage de supabase-js
    // directamente, sin llamar a ningún método de red), se entra
    // en modo offline DE UNA, sin intentar ninguna llamada de red
    // primero.
    if (!navigator.onLine) {
        const haySesionGuardadaEnDispositivo = Object.keys(localStorage)
            .some((clave) => /^sb-.*-auth-token$/.test(clave));
        if (haySesionGuardadaEnDispositivo && entrarModoOfflineConPerfilCacheado()) {
            return;
        }
    }

    let session;
    try {
        // FIX-VELOCIDAD-2 (2026-08-09): navigator.onLine solo dice si
        // el dispositivo tiene una interfaz de red activa (wifi/datos
        // conectados), NO si esa red realmente llega a internet - el
        // caso típico es wifi conectado a un router sin servicio, o
        // datos móviles con señal pero sin cobertura real de datos.
        // En ese caso navigator.onLine sigue en true, así que el
        // atajo de arriba no se activa y esto intentaba getSession()
        // "a pelo": si el token estaba vencido, supabase-js esperaba
        // la respuesta real del servidor, que en una red así no
        // falla al instante sino recién tras varios segundos (por
        // eso el splash se quedaba "un ratito" pegado, exactamente
        // el bug reportado). Ahora esta llamada tiene su propio
        // timeout corto: si no resuelve en TIMEOUT_RED_ARRANQUE_MS
        // se trata como error de conexión de una, sin esperar nada
        // más.
        const resultado = await conTimeoutArranque(window.supabaseClient.auth.getSession(), TIMEOUT_RED_ARRANQUE_MS);
        session = resultado.data.session;
    } catch (err) {
        // FIX (2026-08-09): esta llamada no tenía try/catch. Si el
        // dispositivo abre la app sin internet (o con conexión
        // inestable) justo cuando supabase-js intenta renovar solo
        // un access token ya vencido - algo típico apenas se
        // reabre la app tras un buen rato inactiva/en segundo
        // plano, que es cuando ese token (dura ~1h) ya caducó -,
        // esto lanzaba un error sin atrapar: la función se cortaba
        // ahí mismo y la persona quedaba pegada en el splash o
        // mandada al login, aunque la sesión guardada en el
        // dispositivo siguiera siendo válida y solo faltara
        // internet para renovarla. Ahora, si fue por conexión, se
        // entra en modo offline con el último perfil guardado en
        // vez de exigir login.
        console.error('getSession() falló al arrancar la app:', err);
        if (esErrorDeConexion(err) && entrarModoOfflineConPerfilCacheado()) {
            return;
        }
        window.showLoginScreen();
        return;
    }

    // Ocultar login-screen inmediatamente si hay sesión activa
    const loginScreen = document.getElementById('login-screen');
    if (session && loginScreen) {
        loginScreen.classList.add('hidden');
    }

    // F5 (2026-08-07): si la sesión guardada ya venció según el
    // tiempo de sesión configurado por la persona en este
    // dispositivo, cerrarla acá mismo (antes de cargar el perfil o
    // mostrar ningún panel) y mandar al login normal, en vez de
    // restaurar una sesión que ya debía haber pedido usuario/
    // contraseña de nuevo.
    if (session && sesionExpiradaPorTiempo()) {
        try {
            await window.supabaseClient.auth.signOut();
        } catch (err) {
            console.error('No se pudo cerrar la sesión vencida:', err);
        }
        localStorage.removeItem('cuevacoin_sesion_inicio');
        window.showLoginScreen();
        return;
    }
    if (session) iniciarRelojSesionSiNoExiste();

    if (session) {
        try {
            // B3: mismo fix que en el login — sincronizar el token con
            // Realtime ANTES de abrir cualquier canal, para no
            // depender de la carrera con onAuthStateChange.
            window.supabaseClient.realtime.setAuth(session.access_token);
            // FIX-VELOCIDAD-2 (2026-08-09): misma razón que el
            // timeout agregado a getSession() más arriba - esta es
            // la otra llamada de red real del arranque (trae el
            // perfil desde Supabase), así que también necesita su
            // propio timeout corto para no colgar el splash cuando
            // hay "red sin internet real" (navigator.onLine=true
            // pero sin respuesta).
            let usuario = await conTimeoutArranque(window.obtenerMiPerfilApp(), TIMEOUT_RED_ARRANQUE_MS);
            // BUGFIX (2026-08-08, causa real del alert "DIAGNÓSTICO
            // LOGIN... Cannot read properties of null (reading
            // 'googleVinculado')"): justo después de que
            // getSession() encuentra una sesión guardada (recién
            // arrancó la app, o recién se cerró el popup de
            // Google), auth.getUser() puede tardar un instante en
            // terminar de validar esa sesión contra el servidor y
            // devolver momentáneamente sin usuario - window.obtenerMiPerfilApp()
            // entonces devuelve null (no es un error real, es una
            // carrera de timing), y sincronizarVinculacionGoogleSiCorresponde(null)
            // rompía al leer null.googleVinculado. Antes de darlo
            // por perdido, reintentar UNA vez tras una pausa corta
            // (la sesión ya está confirmada válida por getSession(),
            // así que casi siempre alcanza).
            if (!usuario) {
                await new Promise(resolve => setTimeout(resolve, 700));
                usuario = await window.obtenerMiPerfilApp();
            }
            if (!usuario) {
                // Seguía sin encontrar el perfil después del
                // reintento - ahora sí es una falla real (no una
                // carrera de timing). Mandar al login en vez de
                // romper con un error críptico.
                window.showLoginScreen();
                return;
            }
            // F-GMAIL: esto también cubre el caso de volver del
            // redirect de Google (window.vincularConGoogle()/
            // window.iniciarSesionConGoogle()) - si ya tiene la identidad
            // de Google pero la base de datos todavía no lo sabe,
            // acá se confirma antes de decidir qué pantalla mostrar.
            usuario = await sincronizarVinculacionGoogleSiCorresponde(usuario);
            // AVISO-CUENTA-YA-EXISTIA (2026-08-08): si llegamos
            // ACÁ (perfil encontrado sin pasar por el PGRST116 de
            // abajo) y la bandera dice que el flujo era
            // "window.crearCuentaConGoogle()" (botón "Crear cuenta con
            // Google"), significa que esa identidad de Google YA
            // tenía una cuenta de CuevaCoin de antes - Supabase
            // simplemente inició sesión en ella en vez de crear
            // una nueva (no puede haber 2 cuentas con la misma
            // identidad de Google). Antes esto pasaba en
            // silencio, sin que la persona supiera por qué no le
            // pidieron nombre/usuario nuevo como en un alta real.
            // Se avisa con un toast, sin bloquear ni cambiar el
            // comportamiento (que ya es el correcto).
            if (localStorage.getItem('cuevacoin_google_flujo') === 'signup') {
                window.showToast('Ya tenías una cuenta creada con este correo de Google — te iniciamos sesión en ella.', 5000);
            }
            localStorage.removeItem('cuevacoin_google_flujo');
            sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
            window.entrarSegunVerificacionGoogle(usuario);
            // Punto 36c/36d/36e: si quedó algo en la cola de una
            // sesión anterior (ej. se cerró la app antes de que
            // terminara de sincronizar), reintentar acá.
            window.actualizarIndicadorColaPendiente();
            window.sincronizarColaPendiente();
            return;
        } catch (err) {
            console.error(err);
            // F-GMAIL: "Iniciar sesión con Google" (signInWithOAuth,
            // no linkIdentity) puede volver con una cuenta de Google
            // que nunca se vinculó a ningún perfil de CuevaCoin -
            // window.obtenerMiPerfilApp() no encuentra fila (PGRST116) y
            // cae acá. Cerrar esa sesión sola y avisar, en vez de
            // dejarla "colgada" con sesión activa pero sin perfil.
            if (err?.code === 'PGRST116') {
                // F-GMAIL-SIGNUP: si esta sesión de Google vino de
                // window.crearCuentaConGoogle() (flujo === 'signup'), no
                // hay perfil todavía porque es justo lo esperado en
                // una cuenta nueva - hay que ofrecer completarlo,
                // NO cerrar la sesión. Cualquier otro caso (login
                // normal, o volver sin la bandera puesta) mantiene
                // el comportamiento de siempre.
                const flujoGoogle = localStorage.getItem('cuevacoin_google_flujo');
                if (flujoGoogle === 'signup') {
                    const { data: { user: usuarioGoogle } } = await window.supabaseClient.auth.getUser();
                    const identidadGoogle = usuarioGoogle?.identities?.find(i => i.provider === 'google');
                    const correoGoogle = identidadGoogle?.identity_data?.email || usuarioGoogle?.email || '';
                    mostrarCompletarRegistroGoogle(correoGoogle);
                    return;
                }
                // BUGFIX (2026-08-08): antes solo hacía signOut(),
                // dejando el auth.users + identidad de Google que
                // signInWithOAuth ya había creado (para este intento
                // de login que resultó no tener perfil) huérfanos
                // para siempre - mismo problema de fondo que
                // cancelarRegistroGoogle(), ver comentario ahí y el
                // caso real belkisss790@gmail.com. Autolimpieza
                // best-effort antes de cerrar sesión.
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
            // Punto 36b: si getSession() encontró una sesión guardada
            // pero window.obtenerMiPerfilApp() falló por falta de internet (no
            // por otro motivo), entrar igual con el último perfil
            // cacheado en vez de mandar al login. El usuario puede
            // navegar toda la app viendo estos datos (aunque
            // desactualizados); las operaciones que escriben datos
            // están bloqueadas aparte por window.requiereConexionParaOperar().
            if (esErrorDeConexion(err) && entrarModoOfflineConPerfilCacheado()) {
                return;
            }
            // DIAGNÓSTICO (2026-08-08, bug reportado: "al segundo
            // intento de iniciar sesión con Google me manda al
            // login, y solo recargando la página entra bien"): esta
            // es la rama que se ejecuta cuando pasa CUALQUIER error
            // que no sea "cuenta sin vincular" (PGRST116) ni "sin
            // conexión" - hasta ahora mandaba al login sin explicar
            // nada y sin limpiar la sesión, lo que encaja con que un
            // recargado (que vuelve a llamar a esta misma función
            // sin el error pasajero) lo arreglara solo. Muestra el
            // error real en pantalla para poder identificarlo de
            // una vez; borrar este bloque en cuanto se sepa la causa.
            alert('DIAGNÓSTICO LOGIN (mándale una foto de esto a soporte):\n\n' + String(err?.message || err) + (err?.code ? ('\ncódigo: ' + err.code) : ''));
        }
    }
    window.showLoginScreen();
}

if (typeof window !== 'undefined') {
    window.procesarSesionYMostrarPantalla = procesarSesionYMostrarPantalla;
}
