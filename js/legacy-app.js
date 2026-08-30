/**
 * CuevaCoin — js/legacy-app.js
 * Lógica restante del monolito tras Oleada 1 (core+data extraídos).
 * Depende de window.* poblado por módulos core/data.
 * Cargar DESPUÉS de esos módulos.
 * Sin "use strict": las reasignaciones a nombres de estado (canales, flags)
 * actualizan las propiedades de window creadas por state.js.
 */
        // ============================================
        // CONEXIÓN A SUPABASE
        // ============================================

        // F-GMAIL-POPUP (2026-08-07, v94): si esta pestaña tiene
        // window.opener, es porque la abrió iniciarGoogleEnPopup() de más
        // abajo como ventana emergente para el login/registro con Google -
        // NO es una pestaña normal de la app. Cuando Google termina el
        // redirect y vuelve acá con la sesión, supabase-js la detecta y
        // guarda sola en localStorage (detectSessionInUrl, por defecto) -
        // apenas eso pasa, esta ventana ya cumplió su función y se cierra
        // sola. La ventana original (la PWA instalada) sigue viva todo el
        // tiempo y solo nota el cierre del popup para retomar - así se
        // evita el problema real de fondo: un redirect de página COMPLETA
        // dentro de la PWA instalada hace que Android reabra el regreso en
        // una pestaña normal de Chrome en vez de dentro de la app (la app
        // instalada "se pierde"). Con un popup, la PWA nunca navega a
        // ningún lado - solo abre y cierra una ventanita aparte.

        // Detecta si la app corre instalada (standalone), no como pestaña
        // normal de navegador. 'display-mode: standalone' cubre Chrome/
        // Android; navigator.standalone cubre Safari/iOS viejo.

        // Punto de entrada único para login/registro con Google. Si la app
        // corre instalada (standalone), usa un POPUP en vez de un redirect
        // de página completa, precisamente para no salir nunca de la
        // ventana de la app instalada (ver comentario F-GMAIL-POPUP
        // arriba). Si corre como pestaña normal de navegador, un popup no
        // hace falta - se sigue usando el redirect de siempre, más simple
        // y sin depender de que el navegador permita ventanas emergentes.
        async function iniciarGoogleEnPopup(flujo) {
            localStorage.setItem('cuevacoin_google_flujo', flujo);

            if (!corriendoComoAppInstalada()) {
                mostrarCargando();
                try {
                    const { error } = await supabaseClient.auth.signInWithOAuth({
                        provider: 'google',
                        options: { redirectTo: window.location.origin }
                    });
                    if (error) throw error;
                } catch (err) {
                    console.error('Error iniciando flujo de Google:', err);
                    showToast('No se pudo continuar con Google', 3000);
                    ocultarCargando();
                }
                return;
            }

            // F-GOOGLE-POPUP-LENTO (2026-08-07): antes se abría el popup
            // DESPUÉS de esperar la respuesta de signInWithOAuth (viaje de
            // red a Supabase para conseguir la URL de Google) - eso hacía
            // que la ventanita tardara en aparecer y, en varios navegadores
            // Android, un window.open() que ocurre después de un await ya
            // no cuenta como "resultado directo del toque del usuario", así
            // que puede ser bloqueado como popup no solicitado. Ahora se
            // abre la ventana VACÍA de entrada (sincrónico, en el mismo
            // instante del toque - misma idea que el selector de cuentas
            // chico y rápido de la propia app de Claude) y recién después
            // se le manda la URL real de Google una vez que está lista.
            const popup = window.open('', 'cuevacoin_google_popup', 'width=480,height=680');
            if (!popup) {
                // Bloqueado igual pese a ser sincrónico (puede pasar): único
                // respaldo posible es el redirect de página completa de
                // siempre, aunque en standalone tenga el problema conocido -
                // mejor eso que dejar a la persona sin poder entrar.
                showToast('Permite ventanas emergentes para continuar con Google, o usa usuario/contraseña.', 4000);
                mostrarCargando();
                try {
                    const { error: errorRedirect } = await supabaseClient.auth.signInWithOAuth({
                        provider: 'google',
                        options: { redirectTo: window.location.origin }
                    });
                    if (errorRedirect) throw errorRedirect;
                } catch (err) {
                    console.error('Error iniciando flujo de Google (respaldo redirect):', err);
                    showToast('No se pudo continuar con Google', 3000);
                    ocultarCargando();
                }
                return;
            }

            mostrarCargando();
            try {
                const { data, error } = await supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: { redirectTo: window.location.origin, skipBrowserRedirect: true }
                });
                if (error || !data?.url) throw (error || new Error('Sin URL de Google'));

                popup.location.href = data.url;

                const intervalo = setInterval(async () => {
                    if (popup.closed) {
                        clearInterval(intervalo);
                        // FIX (2026-08-08): revisar primero si el popup dejó
                        // un error real guardado (ver el bloque window.opener
                        // arriba en el archivo) antes de asumir éxito/fallo
                        // genérico solo por si hay sesión o no.
                        const errorGuardado = localStorage.getItem('cuevacoin_google_popup_error');
                        if (errorGuardado) {
                            localStorage.removeItem('cuevacoin_google_popup_error');
                            ocultarCargando();
                            localStorage.removeItem('cuevacoin_google_flujo');
                            showToast('❌ Google: ' + errorGuardado, 5000);
                            return;
                        }
                        const { data: { session } } = await supabaseClient.auth.getSession();
                        if (session) {
                            supabaseClient.realtime.setAuth(session.access_token);
                            await procesarSesionYMostrarPantalla();
                        } else {
                            ocultarCargando();
                            localStorage.removeItem('cuevacoin_google_flujo');
                            showToast('No se completó el inicio de sesión con Google', 3000);
                        }
                    }
                }, 500);
            } catch (err) {
                console.error('Error iniciando Google en popup:', err);
                showToast('No se pudo continuar con Google', 3000);
                ocultarCargando();
                if (popup && !popup.closed) popup.close();
            }
        }


        // Punto 7f: canal de Supabase Realtime para que los mensajes de chat
        // lleguen en vivo, sin recargar ni cambiar de sección. Se crea uno
        // solo por sesión de navegador (guardado acá) y se cierra al hacer
        // logout, para no dejar canales abiertos ni duplicados si el usuario
        // inicia sesión varias veces sin recargar la página.
        // Punto 38a: canal aparte para el chat grupal (no depende de
        // destinatario_id, así que no puede compartir filtro con el de
        // arriba). Lo usa tanto admin como trabajador, cualquiera que lo
        // tenga abierto en ese momento.

        // Punto 33: canal de Realtime separado para la tabla "notificaciones"
        // (campanita + punto rojo). Mismo criterio que chatRealtimeChannel: uno
        // solo por sesión, se cierra al hacer logout.

        // E4 (v70): canal de Realtime separado para el saldo propio
        // (perfiles.saldo) - antes solo había Realtime para notificaciones
        // y chats, así que en un segundo dispositivo con sesión abierta la
        // notificación de pago llegaba pero el número en pantalla no
        // cambiaba hasta salir y volver a entrar.
        // BUG-POSTGRES-CHANGES (2026-08-08): igual que los canales de
        // arriba - guardado acá y limpiado antes de volver a suscribirse,
        // para no dejar un canal duplicado si showAdminPanel()/
        // showUserDashboard() corren dos veces sin recargar la página
        // (ver detalle completo del bug en suscribirRealtimeSolicitudesRetiro).
        // A2 (reintento 2026-08-06): red de seguridad para cuando el canal
        // de Realtime queda "colgado" sin avisar (ver detalle completo en
        // suscribirRealtimeNotificaciones).
        // F8 (2026-08-07): true mientras la cuenta del trabajador logueado
        // está desactivada. La lee requiereConexionParaOperar() (bloquea de
        // una las ~25 acciones que ya pasan por ahí) y además se chequea a
        // mano en los 3 formularios que NO pasan por esa función porque
        // tienen su propia lógica de cola offline (perfil, retiro,
        // transferir - ver encolarAccion). El admin nunca la tiene en true.

        // Llave PÚBLICA de VAPID (punto 13a del roadmap: notificaciones push).
        // La llave PRIVADA nunca va aquí en el frontend — vive solo como secreto
        // de la Edge Function que enviará los push (punto 13b, todavía no
        // implementado). Esta llave pública es segura de exponer, es la misma
        // idea que una llave pública de cualquier par asimétrico.

        // El login es por "usuario", pero Supabase Auth pide email.
        // Traducimos internamente: "maria" -> "maria@cuevacoin.local"

        // Un perfil se considera "completo" cuando tiene todos los datos
        // personales necesarios para validar la cuenta (punto 12 del roadmap
        // de mejoras). Mientras falte alguno, se bloquean transferir/retirar.

        // ============================================
        // TELÉFONO: selector de prefijo de país con bandera (punto 12d)
        // ============================================
        // La bandera se calcula a partir del código ISO de 2 letras
        // (no hace falta guardar el emoji, se genera con los "regional
        // indicator symbols" de Unicode).



        // El teléfono se guarda completo (prefijo+número) en perfiles.telefono,
        // ej. "+521234567890". Al editar hay que separarlo de nuevo en el
        // selector de prefijo + el input del número.

        // Convierte una fila de la tabla "perfiles" al formato que
        // ya espera el resto de esta app (nombre, usuario, esAdmin, foto...)

        // Punto 41c: campos de perfil que cada trabajadora puede ocultar del
        // resto (nunca del admin, que siempre ve todo). Default true
        // (visible) si preferencias_privacidad viene null/vacío o no incluye
        // el campo — mismo criterio ya usado en preferencias_notificaciones,
        // así ningún perfil viejo queda con datos ocultos por sorpresa.

        // Punto 41b: abre la ficha de perfil de OTRA trabajadora desde el
        // chat (grupal o privado), respetando lo que ella haya ocultado en
        // Configuración > Privacidad. A diferencia de la "Ficha del Usuario"
        // del admin (ver-usuario-modal, que siempre muestra todo), esta
        // nunca muestra saldo ni estado de la cuenta — son datos internos,
        // no de perfil social entre compañeras.


        // ============================================
        // F-GMAIL: LOGIN DUAL GOOGLE + USUARIO/CONTRASEÑA
        // ============================================
        // Después de un redirect de vincularConGoogle()/iniciarSesionConGoogle(),
        // supabase-js ya dejó la sesión con la identidad de Google agregada
        // (detectSessionInUrl, activado por defecto). Acá revisamos si ese
        // perfil YA tiene esa identidad pero la base de datos todavía dice
        // google_vinculado=false (recién volvió del redirect) y lo
        // actualizamos. Si ya estaba vinculado, no hace nada.

        // Punto de entrada único que reemplaza a llamar showAdminPanel()/
        // showUserDashboard() directamente: decide si la cuenta puede
        // entrar normal o si primero hay que mostrarle el bloqueo de
        // verificación de Google (ver decisión F-GMAIL, 2026-08-07).
        // FIX-CARGANDO-PEGADO (2026-08-07): este es el único punto de
        // entrada común a los 3 desenlaces posibles después de un login/
        // registro/vinculación con Google (bloqueo, admin, o dashboard de
        // usuaria) - pero mostrarCargando() se disparaba antes de abrir el
        // popup de Google (iniciarGoogleEnPopup) y NINGUNA de las 3
        // funciones de destino llamaba a ocultarCargando(), así que el
        // overlay de "Cargando..." se quedaba visible para siempre encima
        // de la pantalla ya cargada (se veía la app de fondo pero tapada
        // por el spinner). Se agrega acá, en el punto único por el que
        // pasan los 3 caminos, en vez de repetirlo en cada función de
        // destino. No hace nada si el overlay ya estaba oculto.


        // F-GMAIL-POPUP (v94): antes esto hacía linkIdentity() con redirect
        // de página completa - mismo problema de fondo que iniciarSesionConGoogle
        // (ver F-GMAIL-POPUP arriba de la creación de supabaseClient). Ahora
        // usa popup cuando la app corre instalada.
        async function vincularConGoogle() {
            if (!corriendoComoAppInstalada()) {
                mostrarCargando();
                try {
                    const { error } = await supabaseClient.auth.linkIdentity({
                        provider: 'google',
                        options: { redirectTo: window.location.origin }
                    });
                    if (error) throw error;
                } catch (err) {
                    console.error('Error vinculando con Google:', err);
                    showToast('No se pudo iniciar la vinculación con Google. Intenta de nuevo.', 3500);
                    ocultarCargando();
                }
                return;
            }

            // F-GOOGLE-POPUP-LENTO (2026-08-07): mismo criterio que
            // iniciarGoogleEnPopup() de arriba - abrir la ventana vacía de
            // entrada, sincrónico con el toque, y recién después mandarle
            // la URL real de Google.
            const popup = window.open('', 'cuevacoin_google_popup', 'width=480,height=680');
            if (!popup) {
                showToast('Permite ventanas emergentes para continuar con Google.', 4000);
                return;
            }

            mostrarCargando();
            try {
                const { data, error } = await supabaseClient.auth.linkIdentity({
                    provider: 'google',
                    options: { redirectTo: window.location.origin, skipBrowserRedirect: true }
                });
                if (error || !data?.url) throw (error || new Error('Sin URL de Google'));

                popup.location.href = data.url;

                const intervalo = setInterval(async () => {
                    if (popup.closed) {
                        clearInterval(intervalo);
                        // FIX (2026-08-08): mismo chequeo que en
                        // iniciarGoogleEnPopup() - si Google/Supabase
                        // rechazó el link (ej. esa cuenta de Google ya está
                        // vinculada a otro usuario), mostrar el motivo real
                        // en vez de repetir la misma pantalla de bloqueo sin
                        // explicación.
                        const errorGuardado = localStorage.getItem('cuevacoin_google_popup_error');
                        if (errorGuardado) {
                            localStorage.removeItem('cuevacoin_google_popup_error');
                            ocultarCargando();
                            showToast('❌ No se pudo vincular: ' + errorGuardado, 5000);
                            return;
                        }
                        console.log('[vincular-google] popup cerrado, llamando a procesarSesionYMostrarPantalla()');
                        await procesarSesionYMostrarPantalla();
                    }
                }, 500);
            } catch (err) {
                console.error('Error vinculando con Google (popup):', err);
                showToast('No se pudo iniciar la vinculación con Google. Intenta de nuevo.', 3500);
                ocultarCargando();
                if (popup && !popup.closed) popup.close();
            }
        }

        // F-GMAIL-SIGNUP: se marca explícitamente como "login" (no
        // "signup") para que, si esta cuenta de Google vuelve sin perfil
        // en la base de datos, procesarSesionYMostrarPantalla() mantenga
        // el comportamiento de siempre (cerrar sesión y avisar que hay que
        // entrar con usuario/contraseña) en vez de ofrecer completar un
        // registro nuevo.
        async function iniciarSesionConGoogle() {
            await iniciarGoogleEnPopup('login');
        }

        // F-GMAIL-SIGNUP (2026-08-07): crea una cuenta NUEVA directamente
        // con Google, en vez de usuario/contraseña. Usa el mismo
        // signInWithOAuth que iniciarSesionConGoogle() (Supabase no
        // distingue "signup" de "login" para OAuth - la primera vez que
        // entra una identidad de Google, crea el auth.users solo); la
        // diferencia real la hace la bandera 'cuevacoin_google_flujo',
        // que le dice a procesarSesionYMostrarPantalla() qué hacer si
        // vuelve sin perfil todavía en `perfiles`: acá SÍ hay que ofrecer
        // completar el registro en vez de cerrar la sesión.
        async function crearCuentaConGoogle() {
            await iniciarGoogleEnPopup('signup');
        }


        // BUGFIX (2026-08-08): antes esto solo hacía signOut(), dejando el
        // auth.users + identidad de Google recién creados por Supabase
        // (signInWithOAuth los crea automáticamente ANTES de llegar acá)
        // huérfanos para siempre - una identidad de Google que quedaba
        // "trabada" y ya no se podía usar ni para vincular ni para crear
        // una cuenta real (ver caso belkisss790@gmail.com, limpiado a
        // mano el 2026-08-08). Ahora se llama primero a la Edge Function
        // de autolimpieza (best-effort: si falla, igual se hace signOut()
        // después como antes, no se bloquea al usuario por esto).

        document.getElementById('completar-registro-google-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            if (!requiereConexionParaOperar()) return;

            const nombre = document.getElementById('completar-google-nombre').value.trim();
            const apellido = document.getElementById('completar-google-apellido').value.trim();
            const usuario = document.getElementById('completar-google-usuario').value.trim();
            const errorEl = document.getElementById('completar-registro-google-error');
            errorEl.textContent = '';

            if (usuario.includes('@') || /\s/.test(usuario)) {
                errorEl.textContent = 'El nombre de usuario no puede contener espacios ni el símbolo @';
                return;
            }

            mostrarCargando();
            try {
                const { data, error } = await supabaseClient.functions.invoke('crear-perfil-google', {
                    body: { nombre, apellido, usuario }
                });
                if (error || !data || data.error) {
                    errorEl.textContent = await extraerMensajeErrorEdgeFunction(error, data);
                    return;
                }

                localStorage.removeItem('cuevacoin_google_flujo');
                const { data: { session } } = await supabaseClient.auth.getSession();
                if (session?.access_token) {
                    supabaseClient.realtime.setAuth(session.access_token);
                }
                const usuarioApp = await obtenerMiPerfilApp();
                sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuarioApp));
                reiniciarRelojSesion();
                closeModal('completar-registro-google-modal');
                entrarSegunVerificacionGoogle(usuarioApp);
                showToast(`¡Bienvenida/o, ${nombre}!`, 3000);
            } catch (err) {
                console.error('Error completando registro con Google:', err);
                errorEl.textContent = 'No se pudo crear la cuenta. Intenta de nuevo.';
            } finally {
                ocultarCargando();
                if (typeof ocultarSplashArranque === 'function') ocultarSplashArranque();
            }
        });

        // ============================================
        // PREFERENCIAS DE ESTE DISPOSITIVO (localStorage - no se sincronizan
        // entre dispositivos a propósito, son de la app en este celular/PC).
        // ============================================
        if (!localStorage.getItem('cuevacoin_theme')) {
            localStorage.setItem('cuevacoin_theme', 'light');
        }
        if (!localStorage.getItem('cuevacoin_sonido_vibracion')) {
            localStorage.setItem('cuevacoin_sonido_vibracion', 'true');
        }
        if (!localStorage.getItem('cuevacoin_tamano_letra')) {
            localStorage.setItem('cuevacoin_tamano_letra', 'normal');
        }

        // BUG CRÍTICO (2026-08-06, v52): ZOOM_POR_TAMANO vivía declarada
        // como `const` mucho más abajo (junto a la función
        // aplicarTamanoLetra, cerca de Configuración), pero se USA acá
        // arriba en la línea siguiente. `const`/`let` quedan en "zona
        // muerta temporal" hasta que el motor de JS llega físicamente a su
        // línea de declaración - acceder antes tira ReferenceError. Como
        // esta llamada corre en el nivel superior del script (no dentro de
        // una función), se ejecuta INMEDIATAMENTE al cargar la página, muy
        // antes de llegar a la declaración real - eso rompía el script
        // completo apenas cargaba, y por eso nada de lo que venía después
        // (incluido el addEventListener del submit del login) llegaba a
        // engancharse. Fix: la constante se declara acá, antes de su primer
        // uso, y se borró la declaración duplicada de más abajo.

        // Cargar tema guardado
        document.documentElement.setAttribute('data-theme', localStorage.getItem('cuevacoin_theme'));
        document.getElementById('dark-mode-toggle').checked = localStorage.getItem('cuevacoin_theme') === 'dark';
        document.getElementById('sonido-vibracion-toggle').checked = localStorage.getItem('cuevacoin_sonido_vibracion') === 'true';
        aplicarTamanoLetra(localStorage.getItem('cuevacoin_tamano_letra'));

        // F5 (2026-08-07): cargar la opción de tiempo de sesión guardada en
        // este dispositivo (por defecto 'nunca', para no cambiar el
        // comportamiento de nadie que no haya tocado esta opción todavía).
        document.getElementById('tiempo-sesion-select').value = localStorage.getItem('cuevacoin_tiempo_sesion') || 'nunca';

        // Llenar el selector de prefijo de país (punto 12d)
        llenarSelectorPrefijos();

        // ============================================
        // FUNCIONES DE INTERFAZ
        // ============================================


        // Animación de entrada al cambiar de sección (pedido del usuario
        // 2026-08-02: "aumenta las animaciones en general"). Se saca y se
        // vuelve a poner la clase para forzar el reflow — si no, el
        // navegador no reinicia la animación cuando se repite la misma
        // sección varias veces seguidas.

        // FIX (2026-08-05, intento 3): eliminado el MutationObserver del intento 1
        // y el will-change del intento 2. El nuevo enfoque usa body con overflow:hidden
        // y .main-content con overflow-y:auto, lo que evita problemas de capas de
        // composición en Android/Chrome.

        // Muestra el submenú de Configuración (config-tabs-bar) solo cuando
        // se entra a una de sus 3 sub-secciones, y marca cuál está activa.
        // En cualquier otra sección lo oculta.



        // Sincroniza el badge de Mi Perfil y el estado (habilitado/
        // deshabilitado) de los botones Transferir/Solicitar Retiro según
        // si el perfil del trabajador está completo o no (punto 12c).

        // Punto 39 (2026-08-03): banner en Inicio invitando a transferir para
        // desbloquear el chat privado. Se muestra solo si el trabajador
        // TODAVÍA no tiene ninguna transferencia registrada (mismo criterio
        // que usa loadContactosPrivado() para armar la lista de contactos
        // habilitados) — en cuanto hace o recibe la primera, se oculta solo.

        // Los botones Transferir/Solicitar Retiro pasan por aquí en vez de
        // llamar a openModal() directo, para bloquear la acción si el perfil
        // del trabajador todavía no está completo.



        // ============================================
        // F1 (v63): FAVORITOS - accesos rápidos para Transferir
        // ============================================
        // Se arma solo con personas con las que el usuario ya tuvo una
        // transferencia (favoritos.favorito_id apunta a un contraparte_id
        // real de transacciones), igual que exige la RLS de "favoritos" y
        // la policy "ver perfiles de contrapartes de transferencia" de
        // perfiles - por eso el join de abajo puede leer nombre/correo del
        // favorito sin violar RLS.




        // Marca/desmarca a la contraparte de una transacción como favorito.
        // contraparteId/nombre vienen de la propia fila de "transacciones"
        // (ya cargada en loadUserHistorial), así no hace falta otra consulta.

        // ============================================
        // F2 (v63): COMPROBANTES - compartir/copiar el detalle de una transacción
        // ============================================
        // Genera un texto simple (no imagen/PDF) con los datos de la operación
        // y usa la Web Share API si el navegador la soporta (celular); si no,
        // cae a copiar al portapapeles. No depende de internet ni de Supabase,
        // arma el texto con los datos que ya están en la tarjeta.


        // Menú de foto de perfil (Ver foto / Cambiar foto). Antes tocar el
        // avatar iba directo al selector de archivo; ahora primero pregunta
        // qué quiere hacer el usuario.

        // F7 (2026-08-06): genera el QR con el número de cuenta del usuario
        // logueado (admin o trabajador) para identificarse rápido. Se
        // regenera cada vez que se abre el modal en vez de guardarse -
        // QRCode.js no tiene un método simple de "limpiar y volver a
        // dibujar" entre distintos usuarios de la misma sesión de
        // navegador (celular compartido), así que se vacía el div a mano.

        // F7-b (2026-08-07): escanear el QR de OTRO perfil para prellenar el
        // destinatario de Transferir. Usa jsQR sobre frames de <video> (sin
        // reconocimiento nativo del navegador, no todos lo tienen). El
        // número de cuenta leído del QR se resuelve a un correo llamando a
        // la Edge Function resolver-cuenta-qr (con service_role) porque la
        // policy SELECT de "perfiles" no deja ver el perfil de un
        // desconocido con quien nunca se transfirió plata (mismo motivo de
        // fondo que E12) - intentar leerlo directo desde el cliente
        // fallaría en silencio por RLS.
        // Reautenticación QR (2026-08-08): true mientras el destinatario de
        // Transferir venga de un escaneo QR sin editar - se usa para pedir
        // la contraseña de la cuenta en vez del confirm() nativo (ver
        // transferir-form submit). Se resetea al reabrir Transferir de cero
        // o si la persona edita el correo a mano (ver listener más abajo).



        // Scanner QR unificado (2026-08-08): 1 solo modal con pestañas
        // "Escanear" (cámara, F7-b) / "Mi QR" (código propio, F7), en vez
        // de 2 modales separados como antes. abrirScannerQR(tabInicial)
        // es el único punto de entrada; recibe 'escanear' o 'mi-qr' según
        // desde dónde se abra (botón de Transferir vs. botón de Mi Perfil).







        // Close modal when clicking outside
        window.onclick = function(event) {
            if (!event.target.matches('.menu-toggle, .menu-toggle *') && 
                !event.target.matches('.sidebar, .sidebar *') && 
                !event.target.matches('.close-sidebar')) {
                const modals = document.querySelectorAll('.modal');
                modals.forEach(modal => {
                    if (event.target === modal) {
                        if (modal.id === 'scanner-qr-modal') {
                            cerrarScannerQR();
                        } else {
                            modal.style.display = 'none';
                        }
                    }
                });
            }
        }

        // ============================================
        // PUNTOS ROJOS DE NOVEDADES DEL MENÚ (punto 40, 2026-08-03)
        // ============================================
        // Mecanismo REUSABLE: cada vez que se agregue algo nuevo a la app,
        // agregar una entrada acá (key única, nunca reusar una vieja) con el
        // id del elemento a mostrar/ocultar en el sidebar. Se guarda en
        // localStorage qué novedades ya vio el usuario (persiste entre
        // sesiones, es por dispositivo). REGLA DE MANTENIMIENTO: cada vez
        // que se agregue una función nueva a la app, sumarla acá Y
        // agregar su explicación en #shared-como-usar.

        // Punto 40 (revisado 2026-08-06): antes .notif-dot-menu (real) y
        // .novedad-dot-menu (novedades de menú) eran independientes y podían
        // mostrarse los 2 a la vez en el mismo botón. Ahora se combinan acá:
        // solo hay 1 punto visual en el botón ☰, que se muestra si CUALQUIERA
        // de los dos motivos está activo. hayNovedadMenuGlobal la actualiza
        // actualizarPuntosRojosMenu(); hayNotifSinLeerGlobal la actualiza
        // actualizarBadgeNotificaciones().



        // ============================================
        // Tanda v77: burbujitas de "mensaje nuevo sin leer" por chat
        // (Soporte/Grupal/Privado) y en el link "Chat" del sidebar. A
        // diferencia de NOVEDADES_MENU de arriba (avisa de una función
        // nueva UNA sola vez y se apaga para siempre), esto es real: se
        // prende cada vez que llega un mensaje que la persona todavía no
        // vio, y se apaga cuando abre esa pestaña. Se guarda "hasta cuándo
        // ya vio cada chat" en localStorage (por usuario y por
        // dispositivo) para que sobreviva a cerrar y volver a abrir la
        // app, no solo a la sesión actual.
        // ============================================

        // ============================================
        // v107: burbujita por CONTACTO (no solo por pestaña) en las listas
        // de chat 1:1 (Soporte del admin con cada trabajadora, y Privado
        // entre trabajadoras) + orden "el más reciente sin leer arriba".
        // Guarda, por dispositivo, hasta cuándo se vio la conversación con
        // cada contacto puntual (distinto del "visto por pestaña" de
        // arriba, que solo sabe si ALGUNA conversación de esa pestaña tiene
        // novedad, no cuál).
        // ============================================
        // tipoVista: 'admin' (chat de soporte) o 'privado' (chat entre
        // trabajadoras). Se llama al abrir la conversación con ese contacto.
        // Trae, para cada contraparte en contactoIds, la fecha del último
        // mensaje entre esa persona y propioId (en cualquier sentido) y si
        // ese último mensaje lo mandó la contraparte (para saber si hay
        // algo "sin leer" de su lado, no de mensajes propios). Una sola
        // consulta para toda la lista en vez de una por contacto.
        // Combina la lista de contactos con el resumen de chat: agrega
        // .unread y .ultimoMensajeEn a cada uno, y reordena poniendo los
        // que tienen novedad primero (el más reciente arriba), dejando el
        // resto en el orden que ya traían (alfabético).

        // Consulta el último mensaje de cada chat (que no sea propio) y lo
        // compara contra lo que ya vio (localStorage) para decidir si
        // mostrar la burbujita apenas se inicia sesión, antes de que
        // llegue nada nuevo por Realtime.


        // ============================================
        // NOTIFICACIONES: CAMPANITA Y PUNTO ROJO (punto 33, pedido del
        // usuario 2026-08-02)
        // ============================================
        // Revisa cuántas notificaciones sin leer tiene el usuario en sesión
        // y muestra/oculta el punto rojo en la campanita (barra de arriba)
        // y en el botón de menú (☰), para que se note aunque el sidebar
        // esté cerrado.

        // Canal de Realtime para que el punto rojo aparezca al instante
        // cuando llega una notificación nueva (retiro aprobado, transferencia,
        // mensaje de chat, etc.), sin que el usuario tenga que recargar.
        // Mismo patrón que suscribirRealtimeChatAdmin/Usuario (punto 7f).

        // E4 (v70): actualiza en vivo el saldo mostrado (Inicio y Perfil)
        // y el que queda cacheado en sessionStorage, cuando perfiles.saldo
        // cambia en otro dispositivo/pestaña con la misma cuenta abierta.
        // Reutiliza el mismo mensaje de "🎉 META_AHORRO" que ya dispara el
        // trigger de la base (D3) - acá solo hace falta refrescar el
        // número, la notificación/modal de meta ya la maneja
        // suscribirRealtimeNotificaciones() por su cuenta.

        // A2: cuando el celular vuelve de segundo plano (se desbloquea la
        // pantalla, se vuelve a esta pestaña), es el momento más probable
        // para que el WebSocket de Realtime haya muerto en silencio - se
        // fuerza un refresco inmediato del badge y una resuscripción del
        // canal, en vez de esperar al próximo tick del polling de 45s.
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState !== 'visible') return;
            const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
            if (!usuarioActual) return;
            actualizarBadgeNotificaciones(usuarioActual.id);
            suscribirRealtimeNotificaciones(usuarioActual.id);
        });
        // Abre/cierra el panel desplegable de notificaciones. Al abrirlo,
        // carga la lista y marca como leídas todas las pendientes (el punto
        // rojo desaparece, igual que cualquier campanita de notificaciones
        // estándar).

        // E5 (v72 -> v73): ahora que `notificaciones.tipo_evento` existe de
        // verdad en la base (migración aplicada con MCP), se usa ESE dato
        // como fuente principal - ya no hay que adivinar por texto para
        // las notificaciones nuevas. El mapeo por texto se deja como
        // respaldo SOLO para filas viejas insertadas antes de esta
        // migración (que tienen tipo_evento = NULL).



        // Cierra el panel de notificaciones si el usuario toca afuera.
        document.addEventListener('click', function(event) {
            const panel = document.getElementById('notif-panel');
            if (!panel || panel.classList.contains('hidden')) return;
            if (!event.target.closest('.notif-bell-wrap')) {
                panel.classList.add('hidden');
            }
        });

        // E5 (v72): click delegado sobre la lista - si el tap cayó dentro
        // de un .notif-item-accionable, navega a la sección de
        // data-seccion y cierra el panel (mismo criterio que tocar afuera).
        document.getElementById('notif-panel-lista').addEventListener('click', function(event) {
            const item = event.target.closest('.notif-item-accionable');
            if (!item) return;
            const seccion = item.dataset.seccion;
            document.getElementById('notif-panel').classList.add('hidden');
            if (seccion) loadSection(seccion);
        });

        // ============================================
        // TOAST NOTIFICATIONS
        // ============================================

        // ============================================
        // MODAL FUNCTIONS
        // ============================================





        // Detecta si un error atrapado en un try/catch es en realidad una
        // falla de conectividad (sin internet) y no un error real de la
        // acción que se intentaba (ej. login). Se usa para no mostrar
        // mensajes engañosos como "usuario o contraseña incorrectos" cuando
        // el problema real es que el dispositivo no tiene internet.

        // ============================================
        // FRANJA DE ESTADO DE CONEXIÓN (puntos 36a + 37, 2026-08-03)
        // ============================================
        // Componente único y reusable de estado de conexión: reemplaza el
        // modal grande del punto 35 y sirve a la vez como base visual del
        // modo offline (punto 36). Se apoya en los eventos 'online'/
        // 'offline' del navegador (más fiables que consultar
        // navigator.onLine una sola vez, que no se actualiza solo).

        // Punto 50 (2026-08-04): mide el alto REAL de la franja (cambia si
        // el mensaje ocupa 1 o 2 líneas en pantallas chicas) y lo guarda en
        // una variable CSS para que .top-bar y .main-content se corran
        // hacia abajo la cantidad justa — así la franja ya no tapa el
        // topbar. Se llama después de cambiar el texto/visibilidad, y
        // también en 'resize' por si gira el celular y el texto se
        // reacomoda en más o menos líneas.


        // Punto 36c/36d/36e: refleja en la franja cuántos cambios quedan
        // sin sincronizar. Si hay internet y algo se quedó trabado (por un
        // error real de un ítem anterior), muestra el link "Sincronizar
        // ahora" para reintentar a mano sin esperar a desconectar/
        // reconectar de nuevo.


        // FIX (2026-08-09): el evento 'online' del navegador es solo una
        // señal de "la interfaz de red cambió de estado" - en Android puede
        // dispararse igual en momentos raros de modo avión (parpadeos de
        // wifi/datos al activar/desactivar, señal muy débil, etc.) SIN que
        // haya internet real todavía. Antes se confiaba ciegamente en ese
        // evento y se mostraba la franja verde "Conexión recuperada" en
        // esos falsos positivos. Ahora, antes de mostrar la franja verde,
        // se hace una comprobación real y rápida (una petición mínima al
        // propio backend, con timeout corto) - si esa comprobación también
        // falla, se asume que fue un evento 'online' falso y no se muestra
        // nada (la franja roja de offline, si correspondía, sigue como
        // estaba).

        // Estado real del navegador: ROJO fijo mientras esté offline, VERDE
        // unos segundos al recuperar conexión y después se oculta sola.
        window.addEventListener('offline', function() {
            actualizarIndicadorColaPendiente();
        });
        window.addEventListener('online', async function() {
            const conexionConfirmada = await hayConexionRealAhora();
            if (!conexionConfirmada) return; // evento 'online' falso, se ignora
            mostrarConexionStrip('online', '✅ Conexión recuperada', 2500);
            sincronizarColaPendiente();
        });
        // Si la página se abre ya sin internet (ej. modo avión), mostrar la
        // franja roja de una vez, sin esperar a que dispare el evento.
        if (!navigator.onLine) {
            actualizarIndicadorColaPendiente();
        }

        // Para fallas puntuales donde el navegador SÍ cree tener internet
        // (navigator.onLine=true) pero una acción concreta falló por red
        // (ej. el servidor no respondió) — usada en el catch del login en
        // vez del viejo modal grande del punto 35, ya deprecado.

        // ============================================
        // BLOQUEO DE OPERACIONES SIN INTERNET (punto 36b, 2026-08-03)
        // ============================================
        // El usuario puede entrar y navegar por TODA la app sin conexión
        // (ver más abajo, inicializarApp con perfil cacheado), pero NINGUNA
        // operación que escriba datos debe intentar ejecutarse offline —
        // en vez de dejar que falle a medias contra Supabase, se corta acá
        // mismo con un mensaje claro. Se llama al principio de CADA función
        // que hace una escritura real (formularios con submit, botones de
        // aprobar/rechazar, chat, etc.) — si devuelve false, esa función
        // debe hacer return de inmediato sin tocar Supabase.

        // ============================================
        // COLA DE SINCRONIZACIÓN OFFLINE (puntos 36c/36d/36e)
        // ============================================
        // A diferencia de requiereConexionParaOperar() (que BLOQUEA la
        // operación y no guarda nada), estas 3 acciones -perfil, Solicitar
        // Retiro y Transferir, en ese orden de simple a complejo- si el
        // usuario las intenta sin internet, se guardan en esta cola local
        // y se mandan solas a Supabase apenas vuelve la conexión, en el
        // mismo orden en que se crearon (FIFO). El resto de las acciones
        // de la app (chat, aprobar/rechazar solicitudes, ajustar saldo,
        // etc.) sigue bloqueada por requiereConexionParaOperar() sin
        // cambios: no se tocaron a propósito.

        // BUG #1 — idempotency key estable para retiros (RPC solicitar_retiro)




        // Dedup de notificación al admin por solicitud_id (evita duplicar si online + cola reintentan)




        // Llamar cuando el usuario intenta perfil/retiro/transferir sin
        // internet: guarda la acción y avisa con el mensaje que pidió el
        // usuario (nunca "Guardado" a secas, para que quede claro que
        // todavía falta que se sincronice de verdad).


        // Recorre la cola en orden y manda cada acción de verdad a
        // Supabase. Los que sí se sincronizan se sacan de la cola; los que
        // fallan por un error REAL (no de red -ej. "Saldo insuficiente")
        // quedan marcados y se avisan, pero no se pierden ni se reintentan
        // solos en bucle para no repetirle el mismo error una y otra vez
        // sin que el usuario se entere.

        // Ejecuta UNA acción encolada contra Supabase. Reusa la misma
        // lógica de validación del servidor que ya tenía cada formulario
        // en su camino "online" (ver retiro-form/transferir-form/
        // datos-personales-form más abajo).

        // ============================================
        // MENSAJE REAL DE ERROR DE EDGE FUNCTIONS (punto 46/46b, 2026-08-03)
        // ============================================
        // supabaseClient.functions.invoke() devuelve el error de 2 formas
        // distintas según el caso, y el código viejo solo miraba una:
        // 1) la función respondió 200 pero puso el problema en el body
        //    (data.error) — ej. "no se encontró el destinatario".
        // 2) la función respondió con status != 2xx (ej. 400 "Saldo
        //    insuficiente") — ahí invoke() NO pone ese mensaje en
        //    error.message (que queda genérico tipo "Edge Function returned
        //    a non-2xx status code"), sino en el Response crudo que viaja
        //    en error.context. Hay que leerlo aparte con .json().
        // Antes esto tapaba mensajes de validación reales (como "Saldo
        // insuficiente") con un genérico de "revisa que esté desplegada",
        // que además era engañoso porque la función SÍ estaba desplegada.
        // Reusar esta función en cualquier invoke() nuevo que se agregue.
        // ============================================
        // MONTOS SOLO ENTEROS, SIN DECIMALES (punto 47, 2026-08-03)
        // ============================================
        // Se valida acá en el cliente (los <input type="number" step="1">
        // ya ayudan con las flechitas, pero no bloquean que se pegue o
        // escriba "10.5" a mano). El servidor (Edge Functions
        // transferir-saldo y el ajuste de saldo del admin) debe validar lo
        // mismo del lado suyo — eso queda para cuando se pueda tocar esas
        // funciones con el conector de Supabase.


        // ============================================
        // OVERLAY "CARGANDO" CON SPINNER (punto 42, 2026-08-03)
        // ============================================
        // Reusable para cualquier operación lenta, no solo el login. Usar
        // siempre en try/finally para garantizar que ocultarCargando() se
        // llame pase lo que pase (éxito, error, o return anticipado).

        // F5 (2026-08-07): TIEMPO DE SESIÓN CONFIGURABLE.
        // cuevacoin_sesion_inicio guarda cuándo fue el último login REAL en
        // este dispositivo (se sella en reiniciarRelojSesion(), llamada
        // desde los 3 puntos donde se confirma un login exitoso: login-form
        // admin, login-form trabajador, y el auto-login de crear-cuenta-
        // propia). cuevacoin_tiempo_sesion guarda la preferencia elegida en
        // Configuración (1h/1d/7d/nunca, por defecto 'nunca' - no rompe a
        // nadie que no haya tocado la opción todavía).
        // Usado al restaurar una sesión ya activa en inicializarApp(): si
        // nunca se selló un inicio (sesiones de antes de que existiera esta
        // función), lo arranca recién ahora en vez de dar por vencida de
        // golpe una sesión que ya estaba adentro sin haber tenido chance de
        // cumplir ningún plazo.

        // F4 (2026-08-07): oculta el splash de arranque (#arranque-splash,
        // visible por defecto en el HTML) apenas se decide qué pantalla
        // mostrar de verdad (login, admin o trabajador) - se llama desde los
        // 3 puntos de entrada (showLoginScreen/showAdminPanel/
        // showUserDashboard) para garantizar que desaparece exactamente
        // cuando la pantalla final ya está lista, sin importar qué camino de
        // inicializarApp() se haya tomado (con sesión, sin sesión, o con
        // sesión pero sin conexión usando el perfil cacheado).

        // ============================================
        // AUTENTICACIÓN Y 2FA
        // ============================================

        // Enter para enviar mensaje en el chat, como cualquier app de chat
        // (pedido del usuario 2026-08-02). El chat no vive dentro de un
        // <form>, por eso se engancha acá directo con keydown en vez de
        // depender de un submit.
        // Fase 6: Enter en chats → js/chat/chat-enter-keys.js (setupChatEnterKeydowns)

        // Enter para iniciar sesión desde los campos de usuario y
        // contraseña (pedido del usuario 2026-08-02). Técnicamente el
        // <form> ya debería mandar Enter al botón "Iniciar Sesión" solo
        // (es un <button type="submit"> dentro de un <form>), pero se
        // refuerza explícito con requestSubmit() para que sea consistente
        // en todos los navegadores/celulares, sobre todo dentro de la PWA
        // instalada. preventDefault() evita que se dispare el submit dos
        // veces (una nativa del navegador + una acá).
        document.getElementById('username').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('login-form').requestSubmit();
            }
        });
        document.getElementById('password').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('login-form').requestSubmit();
            }
        });

        document.getElementById('login-form').addEventListener('submit', async function(e) {
            // FIX (v85): usaba la variable global "username", que en
            // realidad no era el valor del input sino el propio elemento
            // <input id="username"> (el navegador expone los ids como
            // globales de window). Por eso usuarioAEmail() recibía el
            // elemento en vez del texto y fallaba con "usuario.trim is
            // not a function" al iniciar sesión desde PC.
            // FIX (v85): además faltaba e.preventDefault() - el <form>
            // sin este llamado hacía un submit normal del navegador
            // (recarga la página a "/?") antes de que terminara el login,
            // que es la "?" que se ve pegada a la URL en la captura.
            e.preventDefault();
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;

            mostrarCargando();
            try {
                // FIX-LOADING (v129): signInWithPassword + obtenerMiPerfilApp
                // sin timeout podían colgar el overlay "Cargando..." para
                // siempre si la red no respondía tras un auth OK (síntoma
                // reportado: loading infinito después de login exitoso).
                // Mismo patrón que procesarSesionYMostrarPantalla.
                const timeoutMs = (typeof TIMEOUT_RED_ARRANQUE_MS === 'number' ? TIMEOUT_RED_ARRANQUE_MS : 5000);
                const raceTimeout = (promesa, ms) => {
                    if (typeof conTimeoutArranque === 'function') return conTimeoutArranque(promesa, ms);
                    return Promise.race([
                        promesa,
                        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-login')), ms))
                    ]);
                };

                const { data: authData, error: authError } = await raceTimeout(
                    supabaseClient.auth.signInWithPassword({
                        email: usuarioAEmail(username),
                        password: password
                    }),
                    timeoutMs
                );
                if (authError) throw authError;

                // B3: sincronizar el token con el módulo de Realtime ANTES de
                // que showAdminPanel()/showUserDashboard() abran los canales
                // de chat/notificaciones. supabase-js debería hacer esto solo
                // vía onAuthStateChange, pero en la práctica puede haber una
                // demora/carrera entre que se resuelve el login y que el
                // socket de Realtime recibe el token nuevo — mientras tanto,
                // cualquier canal que se abra usa el token anónimo y las
                // policies de RLS (que dependen de auth.uid()) lo bloquean en
                // silencio, sin ningún error visible. Forzarlo acá saca esa
                // duda del medio.
                if (authData?.session) {
                    supabaseClient.realtime.setAuth(authData.session.access_token);
                }

                let usuario = await raceTimeout(obtenerMiPerfilApp(), timeoutMs);
                if (!usuario) {
                    // Reintento corto (misma carrera de timing que en arranque)
                    await new Promise((r) => setTimeout(r, 700));
                    usuario = await raceTimeout(obtenerMiPerfilApp(), timeoutMs);
                }
                if (!usuario) {
                    showToast('No se encontró tu perfil. Contacta al administrador.', 4000);
                    return;
                }

                // F-GMAIL: si viene de un redirect de Google recién
                // vinculado, esto confirma la vinculación en la base de
                // datos. Si sigue sin vincular, corta acá y muestra el
                // bloqueo obligatorio antes de dejar pasar al panel.
                usuario = await raceTimeout(sincronizarVinculacionGoogleSiCorresponde(usuario), timeoutMs);
                if (!usuario.googleVinculado) {
                    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
                    mostrarBloqueoVerificacionGoogle(usuario);
                    return;
                }

                if (usuario.esAdmin) {
                    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
                    reiniciarRelojSesion();
                    showAdminPanel(usuario);

                    // Auditoría en segundo plano: no debe bloquear el fin del
                    // loading ni la UI (antes el await del insert podía dejar
                    // el spinner visible aunque el panel ya estaba listo).
                    supabaseClient
                        .from('auditoria')
                        .insert({
                            usuario_id: usuario.id,
                            usuario_nombre: usuario.nombre || usuario.usuario,
                            accion: 'Iniciar sesión (Admin)'
                        })
                        .then(({ error: errorAuditoriaLogin }) => {
                            if (errorAuditoriaLogin) console.error(errorAuditoriaLogin);
                        })
                        .catch((errAud) => console.error(errAud));
                } else {
                    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
                    reiniciarRelojSesion();
                    showUserDashboard(usuario);
                }

                // Fix v51 (ver comentario en el registro del Service Worker,
                // más arriba): si había una recarga por versión nueva
                // pospuesta porque el usuario estaba escribiendo el login,
                // este es el momento seguro para aplicarla - la sesión ya
                // quedó guardada, así que el reload entra directo al panel
                // sin pedir login de nuevo.
                if (window.recargaSwPendiente) {
                    window.location.reload();
                    return;
                }
            } catch (err) {
                console.error(err);
                if (esErrorDeConexion(err) || /timeout/i.test(String(err?.message || err))) {
                    avisarFallaDeConexionPuntual();
                    showToast('No se pudo completar el inicio de sesión. Revisa tu conexión e intenta de nuevo.', 4000);
                } else {
                    showToast('Usuario o contraseña incorrectos', 3000);
                }
            } finally {
                ocultarCargando();
                if (typeof ocultarSplashArranque === 'function') ocultarSplashArranque();
            }
        });


        // ============================================
        // PANEL DE ADMINISTRADOR
        // ============================================

        // BUGFIX (2026-08-08): esta función NO guardaba el canal creado en
        // ninguna variable ni lo limpiaba antes de volver a suscribirse -
        // a diferencia de suscribirRealtimeNotificaciones/ChatAdmin/Usuario
        // (que sí siguen el patrón "guardar en variable + removeChannel
        // antes de resuscribir"). Si showAdminPanel() corría una segunda
        // vez sin recargar la página (ej. tras el bug de "Cannot read
        // properties of null (reading 'googleVinculado')" en
        // procesarSesionYMostrarPantalla, que puede dejar la app en un
        // estado donde se reintenta el login sin un reload real de por
        // medio), supabaseClient.channel('solicitudes-retiro-admin')
        // devolvía el MISMO canal ya suscrito de la vez anterior (el
        // cliente de Realtime reutiliza canales por nombre de topic), y
        // llamar a .on() sobre un canal ya suscrito tira exactamente
        // "tried to subscribe multiple times... cannot add
        // `postgres_changes` callbacks... after `subscribe()`" - error que
        // solo se solucionaba recargando la página entera (lo que sí
        // resetea el registro de canales en memoria). FIX: mismo patrón
        // que los demás canales, guardar y limpiar antes de resuscribir.


        // FIX E8 (v69): "search-usuario" y "filter-estado" nunca tuvieron
        // ningún addEventListener/onchange - loadAdminUsuarios() leía sus
        // valores UNA sola vez, al entrar a la sección, así que escribir o
        // cambiar el select no volvía a filtrar nada (causa raíz confirmada
        // leyendo el código: nunca hubo wiring, no es una regresión de B4).
        // Mismo patrón de debounce que F4 (350ms) para el texto libre; el
        // select de estado no necesita debounce porque "change" ya dispara
        // una sola vez por selección.



        // ============================================
        // A1 (v58): SELECTOR DE DESTINATARIOS PARA PAGAR SALARIO / DAR BONO
        // ============================================
        // Antes "Pagar Salario" no dejaba elegir a quién (le pagaba a TODAS
        // sin preguntar) y "Dar Bono" solo tenía un input de correo escrito
        // a mano. Ahora ambos formularios abren este mismo modal con
        // buscador y checkboxes; contextoSeleccionDestinatarios ('salario' o
        // 'bono') decide en cuál de los dos arrays guardar la selección al
        // confirmar.






        // ============================================
        // Punto 1 (2026-08-07) + E6 (2026-08-08): CARTEL DE ANUNCIO
        // OBLIGATORIO AL INICIAR SESIÓN, CON DURACIÓN CONFIGURABLE
        // ============================================
        // Fila única en anuncio_app (id=1). El admin la edita desde su
        // sección propia "Anuncios" (separada de Bonos, ver E6); se
        // muestra como cartel grande al iniciar sesión (admin y
        // trabajador) mientras esté vigente, una sola vez por sesión de
        // navegador (sessionStorage), para no repetirse en cada cambio de
        // pantalla aunque la persona esté horas conectada - pero sí vuelve
        // a aparecer en cada apertura nueva de la app mientras el anuncio
        // siga vigente, tal como se decidió con el usuario.
        // duracion_horas: horas desde creado_en hasta que vence. NULL =
        // "hasta que yo lo quite manualmente" (sin vencimiento, el admin
        // lo borra a mano vaciando el mensaje).

        // FIX (2026-08-08): borra el cartel de anuncio de forma explícita
        // (mismo efecto que vaciar el texto y guardar, pero con un botón
        // claro + confirmación, para que no parezca que "no hay forma de
        // quitarlo" una vez publicado). Reutiliza la misma fila anuncio_app
        // (id=1): mensaje a null equivale a "sin cartel" para
        // verificarAnuncioActivo().

        if (typeof window.setupAnuncioAdminForm === 'function') window.setupAnuncioAdminForm();

        // Se llama una vez al entrar (showAdminPanel/showUserDashboard). Si
        // ya se mostró en esta pestaña/sesión, no vuelve a molestar aunque
        // el anuncio siga vigente.


        // ============================================
        // F6 (2026-08-08): ESTADÍSTICAS ADMIN CON GRÁFICAS
        // ============================================
        // Las 3 métricas son las que el propio roadmap sugería como
        // ejemplo (total pagado por mes, retiros pendientes, trabajadoras
        // más activas) - se usaron tal cual en vez de pedirle al usuario
        // que eligiera de cero, para no frenar la tanda. Todo se calcula
        // acá en el cliente a partir de datos que el admin ya puede leer
        // por RLS (transacciones/solicitudes_retiro/perfiles), sin tabla
        // ni RPC nueva. Los objetos Chart se guardan en variables módulo
        // para poder destruirlos y volver a crearlos cada vez que se entra
        // a la sección (si no, Chart.js apila canvases y se ve superpuesto).

        // Punto 10 (2026-08-09): filtro de rango hoy/semana/mes/año para las
        // 3 gráficas de Estadísticas, en reemplazo del período fijo de
        // "últimos 6 meses" que tenían antes. calcularRangoEstadisticas()
        // calcula la fecha de inicio (usada para filtrar las 3 consultas) y,
        // para la gráfica de pagos, además arma los "buckets" (columnas) que
        // le corresponden a ese rango - día por día para hoy/semana/mes, mes
        // por mes para año.







        // ============================================
        // F8 (2026-08-07): AVISO DE CUENTA DESACTIVADA + MODO SOLO LECTURA
        // ============================================
        // Respuesta del usuario (v88->v89): el aviso se muestra UNA VEZ al
        // entrar (no bloquea el resto de la app) y después el trabajador
        // sigue navegando en modo solo lectura. cuentaDesactivadaGlobal es
        // lo que de verdad bloquea las acciones (ver
        // requiereConexionParaOperar y los 3 formularios con guard propio
        // más abajo); el modal es solo el aviso, se puede volver a mostrar
        // cada vez que arranca una sesión nueva mientras siga desactivada.


        // ============================================
        // Punto 2 (2026-08-07): "PRÓXIMOS BONOS / FORMAS DE GANAR DINERO"
        // ============================================
        // Fila única en contenido_bonos (id=1), editable por el admin desde
        // Bonos, visible a las trabajadoras en su propia sección de Bonos.
        // Burbuja de aviso: se guarda en localStorage (por usuario y
        // dispositivo, mismo criterio que las burbujitas de chat de v77) la
        // fecha del último contenido que esa trabajadora ya vio; si
        // actualizado_en es más nueva, se prende el punto en el sidebar.

        if (typeof window.setupContenidoBonosForm === 'function') window.setupContenidoBonosForm();



        // Se llama al entrar como trabajador (showUserDashboard) para
        // decidir si prender la burbuja - compara actualizado_en contra lo
        // último que esa persona vio.

        // Se llama al abrir la sección Bonos como trabajador - marca como
        // visto el contenido actual y apaga la burbuja.

        // ============================================
        // D2 (v58): BUZÓN DE SUGERENCIAS (sección Bonos)
        // ============================================
        // E11 (v62): textos predefinidos para que el admin no tenga que
        // escribir la respuesta desde cero cada vez - son un punto de
        // partida editable (se insertan en el textarea, no se mandan
        // directo), así el admin siempre puede ajustarlos antes de enviar.


        // Chips de plantillas rápidas (E11): cada una rellena el textarea
        // de esa sugerencia puntual, editable antes de enviar.






        // E2 (v62): punto de aviso en "Bonos" del sidebar - para el admin,
        // cuenta sugerencias sin leer; para la trabajadora, cuenta sus
        // propias respuestas sin ver. Reusa el mismo span/clase que ya
        // usan Solicitudes de Retiro (B6) y Chat.

        // Realtime sobre la tabla sugerencias, para que el punto de aviso
        // de "Bonos" (y la lista, si la sección está abierta) se actualicen
        // solos sin recargar - mismo patrón que suscribirRealtimeSolicitudesRetiro.



        // Punto 49 (aclarado 2026-08-06): mismo patrón visual que
        // loadAdminSolicitudes() (retiros), pero para las solicitudes de
        // cambio de correo que quedan pendientes de aprobación del admin.


        // "se procesará en 1-2 días") SIN aprobar ni rechazar la solicitud
        // todavía — queda pendiente igual, esto es solo para avisarle mientras
        // tanto. Usa el mismo mecanismo de "notificaciones" que aprobar/rechazar.

        // Clasifica cada entrada de auditoría por tipo de evento, a partir de
        // palabras clave en el texto libre de 'accion' (la tabla no tiene una
        // columna de tipo separada). Si en el futuro se agrega una entrada
        // nueva que no calce con ninguna palabra clave de abajo, cae en
        // 'otro' y sigue apareciendo en "Todos los eventos" igual - solo no
        // aparece en ningún filtro específico hasta que se sume su categoría.

        // E13 (v71): debounce del texto libre y del buscador de usuario (350ms,
        // mismo criterio que F4) para no relanzar el filtrado en cada tecla.

        // E13 (v71): llena el <datalist> con los nombres únicos que ya
        // aparecen en la auditoría (usuario_nombre), para que el buscador de
        // usuario ofrezca autocompletado sin necesitar una tabla aparte ni un
        // modal - se llama una sola vez al entrar a la sección.



        // Helpers de chat (pedido del usuario 2026-08-02): un mismo criterio
        // para admin y trabajador, para no duplicar la lógica de scroll ni
        // de animación en cada función.
        // Punto 41b: remitenteId es opcional — cuando se pasa (y el mensaje
        // no es propio), el nombre del remitente queda clickeable para abrir
        // su ficha de perfil (respetando su privacidad, ver
        // verPerfilDesdeChat). No se usa en el chat de Soporte del lado del
        // trabajador (ahí el admin siempre aparece como "Soporte Técnico",
        // decisión ya tomada en el punto 16a, nada que ver desde ahí).
        // Punto 51: nombreRemitente solo se muestra si mostrarNombre es true
        // (chat grupal, para saber quién habla) Y el mensaje no es propio —
        // en 1:1 (soporte/privado) no hace falta, ya lo dice el encabezado
        // de la conversación. La fecha ahora se recibe cruda (ISO) porque
        // la burbuja solo muestra la hora; el día lo pone el separador de
        // fecha (crearSeparadorFechaEl).
        // HALLAZGO-XSS-CHAT (2026-08-09): antes el texto del mensaje y el
        // nombre del remitente se insertaban vía innerHTML tal cual venían
        // de la base, sin escapar - cualquier trabajadora podía mandar un
        // mensaje con HTML/script y que se ejecutara en el navegador de
        // quien lo leyera (admin incluido). escapeHTML() convierte los
        // caracteres especiales a entidades usando el propio DOM (no hay
        // parsing de HTML de por medio, es texto -> texto seguro).


        // Punto 51: "Hoy" / "Ayer" / fecha completa para el separador que
        // aparece entre tandas de mensajes de días distintos.


        // true si el scroll ya estaba pegado (o casi) al final ANTES de
        // agregar contenido nuevo — así solo se fuerza el scroll al fondo
        // si el usuario ya estaba mirando lo último, y se respeta su
        // posición si se corrió hacia arriba a buscar mensajes viejos.

        // Punto 51: agrega un mensaje al contenedor insertando antes un
        // separador de fecha si el día cambió respecto al último elemento
        // ya mostrado (mensaje o separador anterior).

        // Agrega UN mensaje al final del contenedor (para el evento de
        // Realtime, sin recargar toda la conversación) y solo baja el
        // scroll si corresponde.



        // Punto 7f: Realtime del lado del admin. Escucha SOLO los mensajes
        // donde el admin es destinatario (o sea, mensajes que le mandó
        // cualquier trabajador) — el filtro ya hace que nunca llegue un
        // evento por un mensaje que el propio admin mandó (esos se ven al
        // instante porque sendAdminMessage() ya llama a loadAdminChat()
        // directo, sin esperar a Realtime).

        // Punto 7f: Realtime del lado del trabajador. Escucha SOLO los
        // mensajes donde el trabajador es destinatario (o sea, mensajes que
        // le mandó el admin) — mismo motivo que arriba, sus propios mensajes
        // ya se ven al instante vía sendUserMessage() sin esperar a esto.

        // ============================================
        // PUNTO 38: Chat Grupal (todos los usuarios/trabajadoras) y Chat
        // Privado (solo entre dos trabajadoras que ya se transfirieron
        // saldo entre sí). Funciones compartidas por admin y trabajador
        // donde aplica (el chat grupal lo pueden usar los dos roles; el
        // privado, según la RLS de la tabla "chat", es solo entre
        // trabajadoras, el admin no participa ahí).
        // ============================================

        // Punto 51: rediseño de chat estilo WhatsApp para las dos
        // conversaciones 1:1 que antes usaban un <select> de destinatario
        // (soporte del admin y privado del trabajador). El <select> sigue
        // en el DOM (oculto) como única fuente de verdad del "destinatario
        // elegido" — así todo el código que ya lee/escribe su .value
        // (loadAdminChat, sendAdminMessage, abrirVerUsuarioModal,
        // suscripciones Realtime, etc.) sigue funcionando sin tocarlo.
        // Lo que cambia es solo la capa visual: una lista de contactos en
        // vez del <select>, y una "vista de conversación" con header
        // (flecha + avatar + nombre) que se muestra/oculta al elegir un
        // contacto, con la burbuja de mensajes y la barra de input fija
        // adentro.
        const CHAT_LISTA_CONFIG = {
            admin: {
                selectId: 'admin-chat-destinatario',
                listaContainerId: 'admin-chat-lista-contactos',
                listaWrapId: 'admin-chat-lista-contactos',
                conversacionId: 'admin-chat-conversacion',
                avatarId: 'admin-chat-conv-avatar',
                nombreId: 'admin-chat-conv-nombre',
                clickeablePerfil: false
            },
            privado: {
                selectId: 'user-chat-privado-destinatario',
                listaContainerId: 'user-chat-privado-lista-contactos',
                listaWrapId: 'user-chat-privado-ayuda-wrap',
                conversacionId: 'user-chat-privado-conversacion',
                avatarId: 'user-chat-privado-conv-avatar',
                nombreId: 'user-chat-privado-conv-nombre',
                clickeablePerfil: true
            }
        };

        // Dibuja la lista de contactos a partir de los mismos datos que ya
        // se usan para llenar el <select> oculto correspondiente.
        // contactos: [{id, nombre, subtitulo}]

        // Muestra la conversación abierta (o la lista, si no hay nada
        // seleccionado) según el .value actual del <select> oculto, y
        // actualiza el header (avatar + nombre) y qué item de la lista
        // queda marcado como activo. Se llama tanto al cambiar de
        // contacto como al recargar una conversación ya abierta, para que
        // la vista nunca quede desincronizada del estado real.

        // Click en un contacto de la lista: elige ese destinatario en el
        // <select> oculto (disparando su onchange, que carga los mensajes
        // igual que antes) y abre la vista de conversación.

        // Flecha "←" del header: vuelve a la lista de contactos sin perder
        // la selección (al reabrir la conversación sigue ahí).

        // Alterna entre las pestañas de una sección de chat (admin o
        // user) sin recargar la sección entera, y dispara la carga de
        // datos de la pestaña recién abierta.



        // El chat grupal no tiene destinatario_id (es NULL a propósito), así
        // que necesita su propio canal — no puede compartir el filtro
        // "destinatario_id=eq..." del chat de soporte/privado de arriba.

        // Punto 38b: arma la lista de compañeras con las que el trabajador
        // actual ya tiene AL MENOS una transferencia registrada (en
        // cualquiera de los dos sentidos). Alcanza con mirar las propias
        // filas de "transacciones" con tipo = 'transferencia', porque
        // transferir-saldo siempre inserta una fila para cada lado con el
        // otro como contraparte_id — no hace falta revisar el sentido
        // contrario por separado.

        // Punto 43: al enviar una transferencia, revisa si esa contraparte
        // es NUEVA (primera transferencia entre ambos) y, si lo es, muestra
        // el modal de felicitación por chat privado desbloqueado. Alcance:
        // solo se dispara del lado de quien ENVÍA la transferencia (no del
        // que la recibe), porque es el momento en que el cliente ya sabe
        // con certeza que la operación se completó.




        // ============================================
        // ACCIONES DE ADMIN
        // ============================================
        document.getElementById('nuevo-usuario-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            if (!requiereConexionParaOperar()) return;
            const nombre = document.getElementById('nuevo-usuario-nombre').value;
            const usuario = document.getElementById('nuevo-usuario-usuario').value;
            const contrasena = document.getElementById('nuevo-usuario-contrasena').value;
            const valorSaldoInicial = document.getElementById('nuevo-usuario-saldo').value;
            // El saldo inicial sí puede ser 0 (a diferencia de retiros/
            // transferencias/ajustes), así que no se usa esMontoEnteroValido
            // acá (esa exige > 0) — solo se chequea que, si escribió algo,
            // sea un entero.
            if (valorSaldoInicial && !Number.isInteger(Number(valorSaldoInicial))) {
                showToast('El saldo inicial debe ser un número entero, sin decimales', 3500);
                return;
            }
            const saldo = valorSaldoInicial ? parseInt(valorSaldoInicial, 10) : 0;

            const { data, error } = await supabaseClient.functions.invoke('crear-trabajador', {
                body: { nombre, usuario, contrasena, saldoInicial: saldo }
            });

            if (error || data?.error) {
                console.error(error || data.error);
                showToast(await extraerMensajeErrorEdgeFunction(error, data), 4000);
                return;
            }

            showToast('Trabajadora creada correctamente', 3000);
            closeModal('nuevo-usuario-modal');
            document.getElementById('nuevo-usuario-form').reset();
            loadAdminUsuarios();
            loadAdminStats();
            loadChatDestinatarios();
        });

        document.getElementById('ajustar-saldo-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            if (!requiereConexionParaOperar()) return;
            const usuarioId = document.getElementById('ajustar-usuario-id').value;
            const valorCantidadAjuste = document.getElementById('ajustar-cantidad').value;
            if (!esMontoEnteroValido(valorCantidadAjuste)) {
                showToast('La cantidad debe ser un número entero mayor a 0, sin decimales', 3500);
                return;
            }
            const cantidad = parseInt(valorCantidadAjuste, 10);
            const tipo = document.getElementById('ajustar-tipo').value;
            const motivo = document.getElementById('ajustar-motivo').value || 'Ajuste por admin';
            const admin = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
            const cantidadFinal = tipo === 'deposito' ? cantidad : -cantidad;

            // 1) Leer el saldo real y actual desde Supabase (nunca confiar en el
            //    valor que ya está pintado en pantalla, puede estar desactualizado)
            const { data: perfil, error: errorLeer } = await supabaseClient
                .from('perfiles')
                .select('saldo, nombre, usuario')
                .eq('id', usuarioId)
                .single();
            if (errorLeer) {
                console.error(errorLeer);
                showToast('No se pudo leer el saldo actual', 3000);
                return;
            }

            const saldoAntes = Number(perfil.saldo);
            const saldoDespues = saldoAntes + cantidadFinal;

            // 2) Actualizar el saldo en perfiles
            const { error: errorUpdate } = await supabaseClient
                .from('perfiles')
                .update({ saldo: saldoDespues })
                .eq('id', usuarioId);
            if (errorUpdate) {
                console.error(errorUpdate);
                showToast('No se pudo ajustar el saldo', 3000);
                return;
            }

            // 3) Registrar la transacción
            const { error: errorTransaccion } = await supabaseClient
                .from('transacciones')
                .insert({
                    usuario_id: usuarioId,
                    admin_id: admin.id,
                    tipo: tipo === 'deposito' ? 'deposito_admin' : 'retiro_admin',
                    cantidad: cantidadFinal,
                    saldo_antes: saldoAntes,
                    saldo_despues: saldoDespues,
                    motivo: motivo
                });
            if (errorTransaccion) console.error(errorTransaccion);

            // 4) Notificar al trabajador
            const mensajeAjusteSaldo = `El admin ajustó tu saldo: ${tipo === 'deposito' ? '+' : ''}$${Math.abs(cantidadFinal).toFixed(2)}. Motivo: ${motivo}`;
            const { error: errorNotificacion } = await supabaseClient
                .from('notificaciones')
                .insert({
                    usuario_id: usuarioId,
                    mensaje: mensajeAjusteSaldo,
                    leida: false,
                    tipo_evento: 'ajuste_saldo'
                });
            if (errorNotificacion) console.error(errorNotificacion);

            // 4b) Mandar push real (punto 13c-1). No bloquea el flujo si falla
            // (el usuario ya no tiene notificaciones activadas, sin internet
            // por un momento, etc.) — solo se registra en consola.
            supabaseClient.functions.invoke('enviar-push', {
                body: { usuario_id: usuarioId, mensaje: mensajeAjusteSaldo, tipo_evento: 'ajuste_saldo' }
            }).catch((err) => console.error('Error mandando push de ajuste de saldo:', err));

            // 5) Registrar en auditoría
            const { error: errorAuditoria } = await supabaseClient
                .from('auditoria')
                .insert({
                    usuario_id: admin.id,
                    usuario_nombre: admin.nombre || admin.usuario,
                    accion: `Ajustó saldo de ${perfil.nombre || perfil.usuario}: ${tipo === 'deposito' ? '+' : ''}$${Math.abs(cantidadFinal).toFixed(2)} (Motivo: ${motivo})`
                });
            if (errorAuditoria) console.error(errorAuditoria);

            showToast('Saldo ajustado correctamente', 3000);
            closeModal('ajustar-saldo-modal');
            document.getElementById('ajustar-saldo-form').reset();
            loadAdminUsuarios();
            loadAdminStats();
        });

        // F7 (fix): antes esta función solo desactivaba y el botón se
        // quedaba diciendo "Desactivar" para siempre, sin forma de volver a
        // activar la cuenta desde la UI. Ahora lee el estado actual y
        // alterna: si está "activo" pasa a "inactivo" y viceversa. Se
        // mantiene el nombre eliminarUsuario() por compatibilidad (no borra
        // de verdad, ver nota abajo), pero ahora es un toggle real.

        // HALLAZGO-RETIROS-ATOMICO (2026-08-09): aprobar/rechazar retiros
        // reescritos por completo. Antes hacían SELECT saldo + UPDATE saldo
        // como 2 pasos separados desde el cliente (ventana de carrera real:
        // 2 aprobaciones/rechazos casi simultáneos, o el mismo admin en 2
        // pestañas, podían pisarse el saldo). Ahora ambos llaman a la
        // función de Postgres admin_resolver_retiro() (SECURITY DEFINER,
        // con FOR UPDATE sobre la solicitud y sobre el perfil), mismo
        // patrón atómico que ya usan transferir-saldo y admin_pagar_saldo.
        // Todo el UPDATE de solicitud+saldo+transacción+notificación+
        // auditoría pasa a ser una sola transacción de base de datos.



        // Punto 49 (aclarado 2026-08-06): aprobar/rechazar el cambio de
        // correo de un trabajador. Mismo patrón que aprobarSolicitud/
        // rechazarSolicitud (retiro), pero acá no hay dinero de por medio,
        // solo actualizar perfiles.correo si se aprueba.


        // ============================================
        // PANEL DE USUARIO
        // ============================================

        // Frase o mote personal (v48): opcional, se muestra debajo del
        // nombre en el saludo de Inicio y se oculta sola si está vacía.

        // Meta de Ahorro (nueva): progreso = saldo actual / meta_ahorro,
        // tope visual en 100% aunque el saldo la haya superado. Solo se
        // guarda el monto objetivo en la cuenta (perfiles.meta_ahorro); el
        // saldo ya se trackea aparte, no hace falta duplicarlo.



        document.getElementById('meta-ahorro-form').addEventListener('submit', function(e) {
            e.preventDefault();
            const valor = Number(document.getElementById('meta-ahorro-input').value);
            if (!valor || valor <= 0) {
                showToast('Ingresa un monto válido', 3000);
                return;
            }
            guardarCambioMetaAhorro(valor);
        });


        // Mascota reactiva al saldo semanal (nueva): compara el saldo actual
        // contra el saldo de hace 7 días (tomado de la última fila de
        // "transacciones" anterior a esa fecha) y muestra un emoji + mensaje
        // corto según el cambio. Si la cuenta no tiene una semana de
        // historial todavía, se muestra un estado neutral en vez de
        // inventar una comparación con datos incompletos.



        // ============================================
        // PUNTO 28: formato legible de "Última vez"
        // ============================================
        // Reglas pedidas por el usuario: si fue hoy, "03:45PM Hoy"; si fue
        // ayer, "03:45PM Ayer"; si es más antiguo, "DD de MES" (ej. "03 de
        // agosto"). Compara por fecha calendario local, no por diferencia de
        // horas (para que "ayer a las 23:59" siga diciendo "Ayer" y no "Hoy").

        // ============================================
        // PUNTO 29: copiar correo (Inicio)
        // ============================================


        // ============================================
        // NOTIFICACIONES PUSH (punto 13a del roadmap)
        // ============================================
        // El navegador exige la applicationServerKey como Uint8Array, no como el
        // string base64url que generamos: esta función hace esa conversión.

        // Revisa (sin pedir nada al usuario) si este navegador/dispositivo ya
        // tiene una suscripción push activa, para mostrar el botón correcto:
        // "Activar" si no, o un mensaje de confirmación si ya está activado.
        // Actualiza TODOS los botones/mensajes que existan en la página (Inicio
        // y Configuración > Notificaciones comparten las mismas clases).
        // ============================================
        // v107: RESINCRONIZACIÓN SILENCIOSA DE PUSH (arregla "las
        // notificaciones solo llegan si abro la app")
        // ============================================
        // Hasta ahora la ÚNICA vía para grabar la suscripción en Supabase
        // (tabla push_suscripciones) era que la persona tocara a mano el
        // botón "Activar notificaciones" (activarNotificacionesPush). Si
        // esa fila se perdía o quedaba vieja por cualquier motivo (el
        // endpoint de push rotó del lado del navegador/Android, se limpió
        // la tabla, etc.) SIN que la persona volviera a tocar ese botón,
        // el navegador seguía creyendo "ya está activado" (getSubscription()
        // encuentra algo local) pero el servidor ya no tenía a quién
        // mandarle el push real - de ahí el reporte de que solo se entera
        // de algo si abre la app (que solo lee la tabla "notificaciones"
        // directo, sin pasar por push). Esta función corre sola en cada
        // login, sin pedir permiso de nuevo (si ya estaba concedido,
        // subscribe() no muestra ningún cartel) y sin avisar nada en
        // pantalla, y vuelve a dejar grabada en Supabase la suscripción
        // vigente para que nunca quede desincronizada.


        // Pide permiso de notificaciones, crea la suscripción push del navegador
        // y la guarda en Supabase (tabla push_suscripciones) asociada al usuario
        // en sesión. Con esto queda lista la mitad "recibir" del sistema; falta
        // 13b (Edge Function que dispare el push) para que llegue algo de verdad.

        // Punto 23: preferencias de notificaciones (qué eventos mandan push).
        // Carga los 5 switches de #shared-config-notificaciones con el valor
        // real guardado en perfiles.preferencias_notificaciones del usuario
        // que tiene la sesión abierta (admin o trabajador, es la misma
        // sección compartida). Si la columna viene null/vacía por algún
        // motivo, se asume todo activado (true), que es el default seguro.


        // Punto 41c: privacidad de perfil, mismo patrón que las preferencias
        // de notificaciones de arriba (misma columna jsonb approach, ahora
        // sobre perfiles.preferencias_privacidad).


        // FIX (2026-08-05, v45): loadUserNotificaciones() eliminada - era
        // código huérfano de antes del rediseño v40, apuntaba a un
        // contenedor ("user-notificaciones") que ya no existe en el HTML.
        // La funcionalidad real vive en cargarPanelNotificaciones()
        // (campanita del topbar).

        // F4 (v67): debounce del filtro de texto libre (350ms, mismo criterio
        // que el buscador global de F3) para no relanzar la consulta en cada
        // tecla mientras el usuario escribe.

        // F4 (v67): última lista ya filtrada que se pintó en pantalla, para que
        // "Exportar a PDF" exporte exactamente lo que el usuario está viendo,
        // sin tener que repetir la consulta ni la lógica de filtrado.


        // F4 (v67): exporta a PDF exactamente la lista que está en pantalla
        // (ultimoHistorialFiltrado, ya con los 4 filtros aplicados). Texto
        // simple línea por línea, sin tabla compleja - mismo criterio de
        // simplicidad que se usó en F2 (comprobante como texto, no imagen).

        // F5 (v72): abre el modal de Estados de Cuenta con el mes actual
        // preseleccionado (el usuario puede cambiarlo antes de descargar).

        // F5 (v72): resumen mensual descargable en PDF. Reusa la misma
        // tabla `transacciones` que Historial (F4), agrupada por el mes
        // elegido. Saldo inicial = saldo_despues de la última transacción
        // ANTES del mes (0 si no hay ninguna); saldo final = saldo_despues
        // de la última transacción DENTRO del mes (igual al inicial si no
        // hubo movimientos ese mes). Mismo criterio de simplicidad que F4:
        // texto plano línea por línea, sin tabla real (misma DEUDA TÉCNICA
        // anotada ahí - considerar jspdf-autotable si se pide algo más
        // prolijo a futuro).



        // ============================================
        // ACCIONES DE USUARIO
        // ============================================
        document.getElementById('retiro-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const formEl = this;
            const btnSubmit = formEl.querySelector('button[type="submit"]');
            // BUG #1: bloquear doble click ANTES de cualquier await
            if (btnSubmit) btnSubmit.disabled = true;

            const valorCantidadRetiro = document.getElementById('retiro-cantidad').value;
            const cantidad = parseInt(valorCantidadRetiro, 10);
            const motivo = document.getElementById('retiro-motivo').value || 'Solicitud de retiro';
            let usuario = null;
            try {
                usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
            } catch (eSesion) {
                usuario = null;
            }
            if (!usuario || !usuario.id) {
                showToast('Sesión no válida. Vuelve a iniciar sesión.', 3500);
                if (btnSubmit) btnSubmit.disabled = false;
                return;
            }

            // F8: este formulario no pasa por requiereConexionParaOperar()
            // (tiene su propia lógica de cola offline más abajo), así que
            // el modo solo lectura se chequea acá a mano.
            if (cuentaDesactivadaGlobal) {
                showToast('❌ Tu cuenta está desactivada. Contacta a soporte para más información.', 3500);
                closeModal('retiro-modal');
                if (btnSubmit) btnSubmit.disabled = false;
                return;
            }

            if (usuario && !usuario.esAdmin && !usuario.perfilCompleto) {
                showToast('Completa tu perfil antes de solicitar un retiro', 4000);
                closeModal('retiro-modal');
                if (btnSubmit) btnSubmit.disabled = false;
                return;
            }

            if (!esMontoEnteroValido(valorCantidadRetiro)) {
                showToast('La cantidad debe ser un número entero mayor a 0, sin decimales', 3500);
                if (btnSubmit) btnSubmit.disabled = false;
                return;
            }

            // BUG #1: key estable por intención — no se limpia en timeout/red
            let idempotencyKey;
            try {
                if (typeof obtenerOCrearRetiroIdempotencyKey !== 'function') {
                    throw new Error('idempotency_helper_missing');
                }
                idempotencyKey = obtenerOCrearRetiroIdempotencyKey();
                if (!idempotencyKey || typeof idempotencyKey !== 'string') {
                    throw new Error('idempotency_key_invalida');
                }
            } catch (eKey) {
                console.error('Error generando idempotency_key de retiro:', eKey);
                showToast('No se pudo preparar la solicitud. Recarga la app e intenta de nuevo.', 4000);
                if (btnSubmit) btnSubmit.disabled = false;
                return;
            }

            // Offline: encolar con la misma key (no validar saldo acá)
            if (!navigator.onLine) {
                encolarAccion('retiro', {
                    usuario_id: usuario.id,
                    cantidad: cantidad,
                    motivo: motivo,
                    idempotency_key: idempotencyKey,
                    nombre_usuario: usuario.nombre || usuario.usuario
                });
                closeModal('retiro-modal');
                document.getElementById('retiro-cantidad').value = '';
                document.getElementById('retiro-motivo').value = '';
                // Key se limpia al sincronizar con éxito en ejecutarAccionDeCola / o al éxito online
                if (btnSubmit) btnSubmit.disabled = false;
                return;
            }

            try {
                // Garantizar JWT de Supabase Auth antes del RPC (evita 42501 permission denied)
                if (!supabaseClient || typeof supabaseClient.rpc !== 'function') {
                    showToast('Cliente de conexión no listo. Recarga la app.', 4000);
                    return;
                }
                let sessionAuth = null;
                try {
                    const ses = await supabaseClient.auth.getSession();
                    sessionAuth = ses && ses.data ? ses.data.session : null;
                } catch (eSes) {
                    console.error('getSession antes de solicitar_retiro:', eSes);
                }
                if (!sessionAuth || !sessionAuth.access_token) {
                    showToast('Sesión expirada. Vuelve a iniciar sesión para solicitar un retiro.', 4500);
                    return;
                }
                try {
                    supabaseClient.realtime.setAuth(sessionAuth.access_token);
                } catch (eRt) { /* no bloqueante */ }

                // BUG #1: una sola RPC atómica (reserva saldo + insert solicitud)
                // Firma real PostgREST: solicitar_retiro(p_cantidad, p_idempotency_key, p_motivo)
                const { data, error } = await supabaseClient.rpc('solicitar_retiro', {
                    p_cantidad: cantidad,
                    p_motivo: motivo,
                    p_idempotency_key: idempotencyKey
                });

                if (error) {
                    console.error('Error solicitar_retiro:', error, { data: data, key: idempotencyKey });
                    const msg = (error.message || '') + ' ' + (error.details || '') + ' ' + (error.hint || '') + ' ' + (error.code || '');
                    if (/saldo.?insuficiente|insufficient/i.test(msg)) {
                        showToast('Saldo insuficiente', 3000);
                        limpiarRetiroIdempotencyKey();
                    } else if (/retiro_pendiente_existente|ya tienes un retiro pendiente/i.test(msg)) {
                        showToast('Ya tienes un retiro pendiente. Espera a que el admin lo resuelva.', 4000);
                        limpiarRetiroIdempotencyKey();
                    } else if (/idempotency_key_conflict/i.test(msg)) {
                        // Misma key pero otra cantidad/motivo: no es replay válido
                        limpiarRetiroIdempotencyKey();
                        showToast('La solicitud anterior usaba otros datos. Se descartó la clave; intenta de nuevo.', 4500);
                    } else if (/idempotency_key_replay/i.test(msg)) {
                        // Key de una solicitud ya procesada (aprobada/rechazada)
                        limpiarRetiroIdempotencyKey();
                        showToast('Esa solicitud ya fue procesada. Intenta de nuevo con una nueva solicitud.', 4500);
                    } else if (/permission denied|42501|not authorized|JWT|expired|PGRST301/i.test(msg)) {
                        showToast('No autorizado para retirar. Vuelve a iniciar sesión.', 4500);
                    } else if (esErrorDeConexion(error) || /timeout|fetch|network|Load failed/i.test(msg)) {
                        // NO limpiar key: mismo reintento reutiliza la key (replay legítimo)
                        showToast('No sabemos si la solicitud se registró. Puedes reintentar; no se duplicará.', 5000);
                    } else {
                        showToast('No se pudo enviar la solicitud. Intenta de nuevo.', 3500);
                    }
                    return;
                }

                const fila = Array.isArray(data) ? data[0] : data;
                if (fila && fila.error) {
                    if (fila.error === 'saldo_insuficiente') {
                        showToast('Saldo insuficiente', 3000);
                    } else if (fila.error === 'retiro_pendiente_existente') {
                        showToast('Ya tienes un retiro pendiente. Espera a que el admin lo resuelva.', 4000);
                    } else if (fila.error === 'idempotency_key_conflict') {
                        showToast('La solicitud anterior usaba otros datos. Se descartó la clave; intenta de nuevo.', 4500);
                    } else if (fila.error === 'idempotency_key_replay') {
                        showToast('Esa solicitud ya fue procesada. Intenta de nuevo con una nueva solicitud.', 4500);
                    } else {
                        showToast(String(fila.error), 3500);
                    }
                    limpiarRetiroIdempotencyKey();
                    return;
                }

                // ÉXITO solo si la RPC devolvió una solicitud real (evita falso positivo con data vacía)
                if (!fila || !fila.solicitud_id) {
                    console.error('solicitar_retiro sin solicitud_id en respuesta:', { data: data, fila: fila, key: idempotencyKey });
                    showToast('La solicitud no se registró en el servidor. Intenta de nuevo.', 4500);
                    return;
                }

                // Actualizar UI con el saldo reservado por la RPC.
                // Fuente de verdad inmediata: nuevo_saldo de la RPC (o camelCase),
                // con fallback local saldo - cantidad. También actualiza
                // cuevacoin_perfil_cache para que loadSection / modo offline
                // no repinten el saldo anterior.
                {
                    const bruto = (fila.nuevo_saldo != null) ? fila.nuevo_saldo
                        : (fila.nuevoSaldo != null ? fila.nuevoSaldo : null);
                    let nuevoSaldo;
                    if (bruto != null && !Number.isNaN(Number(bruto))) {
                        nuevoSaldo = Number(bruto);
                    } else {
                        const saldoAntes = Number(usuario.saldo);
                        nuevoSaldo = (!Number.isNaN(saldoAntes) ? saldoAntes : 0) - Number(cantidad);
                    }
                    usuario.saldo = nuevoSaldo;
                    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
                    try {
                        localStorage.setItem('cuevacoin_perfil_cache', JSON.stringify(usuario));
                    } catch (eCache) { /* quota / modo privado */ }
                    const saldoSpan = document.getElementById('user-saldo');
                    if (saldoSpan) saldoSpan.textContent = Number(nuevoSaldo).toFixed(2);
                    const perfilSaldoSpan = document.getElementById('perfil-saldo');
                    if (perfilSaldoSpan) perfilSaldoSpan.textContent = Number(nuevoSaldo).toFixed(2);
                    if (typeof actualizarMetaAhorroInicio === 'function') {
                        try { actualizarMetaAhorroInicio(usuario); } catch (eMeta) {}
                    }
                }

                // Notificar admin (dedup); la RPC ya creó la solicitud
                try {
                    const { data: adminRetiro } = await supabaseClient
                        .from('perfiles')
                        .select('id')
                        .eq('es_admin', true)
                        .limit(1)
                        .maybeSingle();
                    if (adminRetiro) {
                        const nombreSolicitante = usuario.nombre || usuario.usuario;
                        const mensajeNotifRetiro = `${nombreSolicitante} solicitó un retiro de $${cantidad}`;
                        await notificarAdminRetiroSiNoDuplicado(fila.solicitud_id, mensajeNotifRetiro, adminRetiro.id);
                    }
                } catch (eNotif) {
                    console.error('Notif admin retiro (no bloquea éxito):', eNotif);
                }

                limpiarRetiroIdempotencyKey();
                showToast('Solicitud de retiro enviada al admin', 3000);
                closeModal('retiro-modal');
                document.getElementById('retiro-cantidad').value = '';
                document.getElementById('retiro-motivo').value = '';
            } catch (err) {
                console.error('Error inesperado en retiro-form:', err);
                if (esErrorDeConexion(err)) {
                    showToast('No sabemos si la solicitud se registró. Puedes reintentar; no se duplicará.', 5000);
                } else {
                    showToast('No se pudo enviar la solicitud. Intenta de nuevo.', 3500);
                }
            } finally {
                if (btnSubmit) btnSubmit.disabled = false;
            }
        });

        // Si la persona toca el campo de correo después de escanear un QR,
        // ya no sabemos con certeza que el destinatario sigue siendo el
        // escaneado - se vuelve a pedir confirm() normal en vez de contraseña.
        document.getElementById('transferir-destinatario-correo').addEventListener('input', function() {
            transferenciaViaQR = false;
        });

        document.getElementById('transferir-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const destinatarioCorreo = document.getElementById('transferir-destinatario-correo').value.trim();
            const valorCantidadTransferir = document.getElementById('transferir-cantidad').value;
            const cantidad = parseInt(valorCantidadTransferir, 10);
            const motivo = document.getElementById('transferir-motivo').value || 'Transferencia';
            let usuarioSesion = null;
            try {
                usuarioSesion = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
            } catch (eSesion) {
                usuarioSesion = null;
            }
            if (!usuarioSesion || !usuarioSesion.id) {
                showToast('Sesión no válida. Vuelve a iniciar sesión.', 3500);
                return;
            }

            // F8: mismo motivo que en retiro-form - guard a mano porque este
            // formulario tiene su propia cola offline.
            if (cuentaDesactivadaGlobal) {
                showToast('❌ Tu cuenta está desactivada. Contacta a soporte para más información.', 3500);
                closeModal('transferir-modal');
                return;
            }

            if (usuarioSesion && !usuarioSesion.esAdmin && !usuarioSesion.perfilCompleto) {
                showToast('Completa tu perfil antes de transferir', 4000);
                closeModal('transferir-modal');
                return;
            }

            if (!destinatarioCorreo) {
                showToast('Escribe el correo electrónico del destinatario', 3000);
                return;
            }

            if (!esMontoEnteroValido(valorCantidadTransferir)) {
                showToast('La cantidad debe ser un número entero mayor a 0, sin decimales', 3500);
                return;
            }

            // Reautenticación QR (2026-08-08, a pedido del usuario): si el
            // destinatario vino de escanear su QR (sin editar a mano), pedir
            // la contraseña de la cuenta en vez del confirm() nativo - paso
            // de seguridad extra porque acá la persona nunca tipeó/revisó el
            // correo del destinatario a mano.
            if (transferenciaViaQR) {
                abrirConfirmarPasswordTransferencia(destinatarioCorreo, cantidad, motivo);
                return;
            }

            // Confirmación explícita antes de mover el dinero: evita transferencias
            // por error (monto o destinatario equivocado). Si el usuario cancela,
            // no se llama a la Edge Function y no se toca el saldo. Funciona igual
            // sin internet (es un diálogo nativo del navegador, no necesita red).
            const confirmado = confirm(`Estás a punto de transferir $${cantidad.toFixed(2)} a ${destinatarioCorreo}. ¿Estás seguro de esto?`);
            if (!confirmado) {
                return;
            }

            await ejecutarTransferencia(destinatarioCorreo, cantidad, motivo);
        });

        // Reautenticación QR (2026-08-08): modal chico con un solo campo de
        // contraseña. Verifica contra Supabase Auth (signInWithPassword con
        // el correo de la sesión actual - mismo patrón que el login) antes
        // de dejar pasar la transferencia. Se guarda la transferencia
        // pendiente en transferenciaPendienteQR mientras se espera la
        // confirmación.



        document.getElementById('confirmar-password-qr-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            if (!transferenciaPendienteQR) return;
            const password = document.getElementById('confirmar-password-qr-input').value;
            const estado = document.getElementById('confirmar-password-qr-estado');
            const usuarioSesion = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');

            if (!password) {
                estado.textContent = 'Escribe tu contraseña para confirmar.';
                return;
            }
            if (!usuarioSesion || !usuarioSesion.correo) {
                estado.textContent = 'No se pudo verificar tu usuario. Cierra este diálogo e intenta de nuevo.';
                return;
            }

            estado.textContent = 'Verificando...';
            const { error: authError } = await supabaseClient.auth.signInWithPassword({
                email: usuarioSesion.correo,
                password: password
            });

            if (authError) {
                estado.textContent = 'Contraseña incorrecta. Intenta de nuevo.';
                return;
            }

            const { destinatarioCorreo, cantidad, motivo } = transferenciaPendienteQR;
            transferenciaPendienteQR = null;
            closeModal('confirmar-password-qr-modal');
            await ejecutarTransferencia(destinatarioCorreo, cantidad, motivo);
        });

        // Punto 8 (2026-08-09): buscar destinatario por nombre de usuario,
        // vía la Edge Function resolver-cuenta-usuario (mismo motivo que
        // resolver-cuenta-qr - RLS no deja ver el perfil de un desconocido
        // desde el cliente). Al encontrar la cuenta, prellena el correo en
        // Transferir igual que hace un QR escaneado (sin marcar
        // transferenciaViaQR, porque acá la persona sí puede revisar/editar
        // el correo resultante a mano si quiere, a diferencia del QR).


        document.getElementById('buscar-usuario-transferir-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            const nombreUsuario = document.getElementById('buscar-usuario-transferir-input').value.trim();
            const estado = document.getElementById('buscar-usuario-transferir-estado');
            if (!nombreUsuario) {
                estado.textContent = 'Escribe un nombre de usuario.';
                return;
            }
            if (!navigator.onLine) {
                estado.textContent = 'Necesitas conexión para buscar un usuario.';
                return;
            }
            estado.textContent = 'Buscando...';
            try {
                const { data, error } = await supabaseClient.functions.invoke('resolver-cuenta-usuario', {
                    body: { nombreUsuario }
                });
                if (error || !data || data.error) {
                    estado.textContent = (data && data.error) ? data.error : 'No se pudo buscar ese usuario.';
                    return;
                }
                document.getElementById('transferir-destinatario-correo').value = data.correo;
                cerrarBuscarUsuarioTransferir();
                const nombreMostrado = [data.nombre, data.apellido].filter(Boolean).join(' ') || data.usuario;
                showToast(`Destinatario cargado: ${nombreMostrado}`, 3000);
            } catch (err) {
                console.error('Error resolviendo usuario buscado:', err);
                estado.textContent = 'Error de conexión buscando ese usuario.';
            }
        });

        // Ejecución real de la transferencia (movida a función aparte en
        // 2026-08-08 para reusarla tanto desde el confirm() normal como
        // desde la confirmación por contraseña del flujo QR).

        // A1 (v58): pagar salario / dar bono, reescritos por completo.
        // Antes hacían un INSERT directo del cliente a "transacciones" (lo
        // más probable es que RLS lo bloqueara en silencio), nunca tocaban
        // perfiles.saldo (el saldo visible del usuario jamás cambiaba) y
        // saldo_antes/saldo_despues quedaban hardcodeados en 0/monto. Ahora
        // ambos llaman a la función de Postgres admin_pagar_saldo() (con
        // service_role vía SECURITY DEFINER), que sí actualiza el saldo real,
        // inserta la transacción con los valores reales y la notificación
        // con el motivo. También agregan el selector de destinatarias (ver
        // abrirSelectorDestinatarios) en vez de "a todas sin preguntar" o un
        // correo escrito a mano.

        document.getElementById('pagar-salario-form').addEventListener('submit', function(e) {
            e.preventDefault();
            pagarSaldoDesdeAdmin('salario');
        });

        document.getElementById('dar-bono-form').addEventListener('submit', function(e) {
            e.preventDefault();
            pagarSaldoDesdeAdmin('bono');
        });

        // D2 (v58): envío del buzón de sugerencias (trabajadora -> admin).
        if (typeof window.setupSugerenciaForm === 'function') window.setupSugerenciaForm();

        document.getElementById('enviar-anuncio-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const mensaje = document.getElementById('anuncio-mensaje').value;
            mostrarCargando();
            try {
                const { data: usuarios } = await supabaseClient.from('perfiles').select('id');
                const mensajeNotifAnuncio = `📢 ANUNCIO: ${mensaje}`;
                for (const usuario of usuarios) {
                    await supabaseClient.from('notificaciones').insert({
                        usuario_id: usuario.id,
                        mensaje: mensajeNotifAnuncio,
                        tipo_evento: 'anuncio'
                    });
                    // Punto 1 (2026-08-09, bug crítico "notificaciones rotas"):
                    // antes acá solo se insertaba en `notificaciones` - la
                    // campanita se actualizaba SI la app ya estaba abierta
                    // (Realtime), pero nunca se mandaba un push real, así
                    // que nadie se enteraba de un anuncio con la app cerrada
                    // o el celular bloqueado. Mismo patrón que ya usan
                    // retiros/chat/sugerencias (enviar-push por cada
                    // destinatario). No se espera cada invoke uno por uno
                    // (fire-and-forget con .catch) para no frenar el envío
                    // del anuncio si algún dispositivo puntual falla.
                    supabaseClient.functions.invoke('enviar-push', {
                        body: { usuario_id: usuario.id, mensaje: mensajeNotifAnuncio, tipo_evento: 'anuncio' }
                    }).catch((err) => console.error('Error mandando push de anuncio a', usuario.id, err));
                }
                showToast('Anuncio enviado a todas las trabajadoras', 3000);
                closeModal('enviar-anuncio-modal');
                document.getElementById('enviar-anuncio-form').reset();
            } catch (error) {
                showToast('Error al enviar anuncio', 3000);
            } finally {
                ocultarCargando();
            }
        });


        // Punto 24 + mejora pedida (2026-08-02): foto de perfil desde galería,
        // con paso de recorte forzado a 1:1 (cuadrado) antes de subir, usando
        // Cropper.js. Subida real a Supabase Storage, bucket "fotos-perfil".

        if (typeof window.setupPerfilFotoInput === 'function') window.setupPerfilFotoInput();




        document.getElementById('datos-personales-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));

            // F8: mismo motivo que en retiro-form/transferir-form - guard a
            // mano porque este formulario tiene su propia cola offline.
            if (cuentaDesactivadaGlobal) {
                showToast('❌ Tu cuenta está desactivada. Contacta a soporte para más información.', 3500);
                return;
            }

            const nombre = document.getElementById('datos-nombre').value.trim();
            const apellido = document.getElementById('datos-apellido').value.trim();
            const numeroCarnet = document.getElementById('datos-numero-carnet').value.trim();
            const fechaNacimiento = document.getElementById('datos-fecha-nacimiento').value;
            const correo = document.getElementById('datos-correo').value.trim();
            const prefijoTelefono = document.getElementById('datos-telefono-prefijo').value;
            const numeroTelefono = document.getElementById('datos-telefono').value.trim();
            const telefono = prefijoTelefono && numeroTelefono ? `${prefijoTelefono}${numeroTelefono}` : '';
            const frasePersonal = document.getElementById('datos-frase-personal').value.trim();

            if (!nombre || !apellido || !numeroCarnet || !fechaNacimiento || !correo || !prefijoTelefono || !numeroTelefono) {
                showToast('Completa todos los campos, incluyendo el país del teléfono', 3000);
                return;
            }

            // Punto 49 (aclarado 2026-08-06): si el trabajador YA tenía un
            // correo cargado y lo está cambiando, no se guarda directo - se
            // manda como solicitud pendiente de aprobación del admin, para
            // que cambiar el correo con facilidad no sea una forma fácil de
            // hacer algo malo (esquivar avisos, intentar suplantar a otro).
            // El admin (editando su propio perfil) queda exento: no tiene a
            // quién pedirle permiso. La primera vez que alguien completa su
            // perfil (correo todavía vacío) tampoco pide permiso - recién
            // aplica a partir del segundo cambio en adelante.
            const correoAnterior = usuario.correo || '';
            const correoCambio = correoAnterior && correo !== correoAnterior;
            const requiereAprobacionCorreo = correoCambio && !usuario.esAdmin;
            
            // Detección de perfil recién completado para notificar al admin
            const perfilEstabaIncompleto = !usuario.perfilCompleto;
            const perfilQuedaCompleto = nombre && apellido && numeroCarnet && fechaNacimiento && correo && telefono;

            if (requiereAprobacionCorreo && !navigator.onLine) {
                showToast('Necesitas conexión a internet para solicitar un cambio de correo', 4000);
                document.getElementById('datos-correo').value = correoAnterior;
                return;
            }

            const cambiosPerfil = {
                nombre: nombre,
                apellido: apellido,
                numero_carnet: numeroCarnet,
                fecha_nacimiento: fechaNacimiento,
                telefono: telefono,
                frase_personal: frasePersonal || null
            };
            // El correo solo se incluye en el update directo si NO requiere
            // aprobación (primera vez, o lo edita el admin) - si requiere
            // aprobación, perfiles.correo se queda como estaba hasta que el
            // admin apruebe la solicitud.
            if (!requiereAprobacionCorreo) {
                cambiosPerfil.correo = correo;
            }

            // Punto 36c: sin internet se encola el cambio y se refleja
            // igual de forma optimista en la UI/sesión (más abajo) — la
            // escritura real en Supabase queda para cuando sincronice.
            if (!navigator.onLine) {
                encolarAccion('perfil', { usuarioId: usuario.id, cambios: cambiosPerfil });
            } else {
                const { error } = await supabaseClient
                    .from('perfiles')
                    .update(cambiosPerfil)
                    .eq('id', usuario.id);

                if (error) {
                    console.error(error);
                    showToast('No se pudieron guardar los datos', 3000);
                    return;
                }
            }

            // Punto 49: si el correo requería aprobación, se manda la
            // solicitud recién ahora que el resto de los datos ya se
            // guardó bien (así no queda una solicitud huérfana si el
            // update de arriba hubiera fallado).
            if (requiereAprobacionCorreo) {
                const { error: errorSolicitudCorreo } = await supabaseClient
                    .from('solicitudes_cambio_correo')
                    .insert({
                        usuario_id: usuario.id,
                        correo_actual: correoAnterior,
                        correo_nuevo: correo,
                        estado: 'pendiente'
                    });
                if (errorSolicitudCorreo) {
                    console.error(errorSolicitudCorreo);
                    showToast('No se pudo enviar la solicitud de cambio de correo', 3000);
                } else {
                    const { data: adminCorreo } = await supabaseClient
                        .from('perfiles')
                        .select('id')
                        .eq('es_admin', true)
                        .limit(1)
                        .single();
                    if (adminCorreo) {
                        const nombreSolicitanteCorreo = usuario.nombre || usuario.usuario;
                        const mensajeSolicitudCorreo = `${nombreSolicitanteCorreo} solicitó cambiar su correo a ${correo}`;
                        await supabaseClient.from('notificaciones').insert({
                            usuario_id: adminCorreo.id,
                            mensaje: mensajeSolicitudCorreo,
                            leida: false,
                            tipo_evento: 'solicitud_cambio_correo'
                        });
                        supabaseClient.functions.invoke('enviar-push', {
                            body: { usuario_id: adminCorreo.id, mensaje: mensajeSolicitudCorreo, tipo_evento: 'solicitud_cambio_correo' }
                        }).catch((err) => console.error('Error mandando push de solicitud de cambio de correo:', err));
                    }
                }
                // El input vuelve a mostrar el correo actual (el nuevo queda
                // pendiente, todavía no es el correo real del perfil).
                document.getElementById('datos-correo').value = correoAnterior;
            }

            // Reflejar los cambios en la sesión y recalcular si el perfil ya quedó completo
            const eraIncompleto = !usuario.perfilCompleto;
            usuario.nombre = nombre;
            usuario.apellido = apellido;
            usuario.numeroCarnet = numeroCarnet;
            usuario.fechaNacimiento = fechaNacimiento;
            // Si el correo requería aprobación, la sesión se queda con el
            // correo ANTERIOR (todavía no cambió de verdad) - solo se
            // actualiza acá cuando no hacía falta pedir permiso.
            if (!requiereAprobacionCorreo) {
                usuario.correo = correo;
            }
            usuario.telefono = telefono;
            usuario.frasePersonal = frasePersonal || null;
            usuario.perfilCompleto = calcularPerfilCompleto(usuario);
            sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));

            document.getElementById('perfil-nombre').textContent = nombre;
            document.getElementById('user-name').textContent = nombre;
            actualizarFrasePersonalInicio(usuario.frasePersonal);
            actualizarEstadoPerfil(usuario);

            // Si el perfil acaba de completarse (punto 12g): volver al inicio
            // de la sección Perfil y reforzar la animación del badge de éxito.
            // F9: además del toast, mostrar el cartel grande de "Verificación
            // Completada" con accesos directos a Transferir/Retiro.
            if (eraIncompleto && usuario.perfilCompleto) {
                showToast('🎉 ¡Felicidades! Tu perfil ya está completo. Ya puedes retirar y transferir tus activos.', 5000);
                openModal('verificacion-completada-modal');
                
                // Notificar al admin que el perfil se completó
                if (!usuario.esAdmin && navigator.onLine) {
                    const { data: adminPerfil } = await supabaseClient
                        .from('perfiles')
                        .select('id')
                        .eq('es_admin', true)
                        .limit(1)
                        .single();
                    
                    if (adminPerfil) {
                        const nombreUsuario = usuario.nombre || usuario.usuario;
                        const mensajePerfilCompleto = `${nombreUsuario} completó su perfil`;
                        const { error: errorNotifPerfil } = await supabaseClient
                            .from('notificaciones')
                            .insert({
                                usuario_id: adminPerfil.id,
                                mensaje: mensajePerfilCompleto,
                                leida: false,
                                tipo_evento: 'perfil_completo'
                            });
                        
                        if (errorNotifPerfil) {
                            console.error('Error notificando perfil completo al admin:', errorNotifPerfil);
                        } else {
                            console.log('Notificación de perfil completo enviada al admin');
                            actualizarBadgeNotificaciones(adminPerfil.id);
                        }
                        
                        supabaseClient.functions.invoke('enviar-push', {
                            body: { usuario_id: adminPerfil.id, mensaje: mensajePerfilCompleto, tipo_evento: 'perfil_completo' }
                        }).catch((err) => console.error('Error push perfil completo:', err));
                    }
                }
            }

            // Si quedó encolado por falta de internet, encolarAccion() ya
            // mostró el toast de "se sincronizará cuando tengas internet" —
            // no lo tapamos con este otro. Si el correo requería aprobación,
            // ese toast tiene prioridad sobre el genérico de "Datos guardados".
            if (requiereAprobacionCorreo) {
                showToast('Datos guardados. Tu cambio de correo quedó pendiente de aprobación del admin.', 4500);
            } else if (navigator.onLine) {
                showToast(usuario.perfilCompleto ? 'Datos guardados. ¡Tu perfil ya está completo!' : 'Datos guardados', 3000);
            }
        });

        if (typeof window.setupCambiarContrasenaForm === 'function') window.setupCambiarContrasenaForm();


        // Preferencias de dispositivo (Oleada 4: js/ui/config-local.js)
        if (typeof window.setupLocalConfigListeners === 'function') {
            window.setupLocalConfigListeners();
        }


        // Tamaño de letra (v47): variable CSS --ui-zoom aplicada con `zoom`
        // sobre <body> (ver comentario junto a la regla body{} para el porqué
        // de zoom en vez de transform). Preferencia de este dispositivo,
        // mismo patrón que cuevacoin_theme y cuevacoin_sonido_vibracion.

        // Paleta de Colores (2026-08-09, antes "Color de Acento"): a
        // diferencia de tema/tamaño de letra (que son preferencia de ESTE
        // dispositivo, en localStorage), la paleta se guarda en la cuenta
        // (perfiles.color_acento) para que se vea igual en todos los
        // dispositivos de la trabajadora. Solo se guarda la CLAVE de la
        // paleta, nunca los hex directamente, para no romper la estética
        // si más adelante se retocan los tonos exactos.
        //
        // Ampliación (2026-08-09): antes esto solo cambiaba --accent-primary/
        // --accent-secondary (la franja de las tarjetas de estadísticas y
        // poco más); el resto de la app (botones, barra superior, bordes,
        // fondos de tarjetas resaltadas, toasts) quedaba SIEMPRE en rosa
        // porque usaba --primary-color/--secondary-color/--light-color/
        // --dark-color/--border-color/--bg-color, que nunca se tocaban.
        // Ahora cada paleta trae también esos valores, así que elegir una
        // paleta cambia el color en TODA la app, no solo el acento.
        //
        // Cada color de cada paleta se eligió y se verificó con la fórmula
        // de contraste WCAG: los textos/blancos que van sobre --secondary-
        // color y --primary-color, y los textos sobre --border-color en
        // modo oscuro, dan todos un contraste mayor a 4.5:1 (AA para texto
        // normal), para que ningún texto quede invisible o poco legible
        // sobre el nuevo color, sea cual sea la paleta elegida. La paleta
        // "rosa" se dejó con sus valores originales para no cambiar el
        // look de quienes ya la vienen usando.
        // Ampliación (2026-08-09, v2): cada paleta ahora es un COMBO de 2-3
        // colores con identidad/personalidad propia (no un solo tono
        // repetido) - el "sidebar" de abajo es el gradiente de 3 colores
        // del menú lateral, que es donde más se nota la combinación. Los
        // colores funcionales (primary/secondary/etc, los que llevan texto
        // encima) se mantienen siempre dentro de los límites de contraste
        // verificados, aunque la paleta sea "escandalosa" - lo llamativo
        // vive en el menú y los degradados decorativos, nunca en un texto.
        // Claves viejas (de cuando solo había 6 acentos rosa/lavanda/menta/
        // amarillo/celeste/coral) mapeadas a las paletas nuevas más
        // parecidas, para que perfiles ya guardados no queden en una clave
        // que ya no existe.





        // Beep corto generado con Web Audio API (sin archivo de audio nuevo
        // que agregar al SHELL_FILES del Service Worker) + vibración corta.
        // Se llama desde suscribirRealtimeNotificaciones() cuando llega una
        // notificación nueva con la app en primer plano.

        // ============================================
        // (Sección "Crear Usuario Admin" eliminada 2026-08-01: era un
        // botón visible en pantalla de login que creaba un admin falso
        // en localStorage con contraseña en texto plano. El admin real
        // ya existe en Supabase Auth desde la primera sesión de
        // migración; ese botón era puramente peligroso/confuso, no
        // tenía ninguna función real desde que se migró el login.)
        // ============================================

        // ============================================
        // INICIALIZAR LA APP
        // ============================================
        // F-GMAIL-POPUP (2026-08-07, v94): antes esto era la IIFE de
        // arranque directamente. Se separó en una función con nombre para
        // poder volver a llamarla después de que se cierra el popup de
        // Google (ver iniciarGoogleEnPopup más abajo) - así no hace falta
        // duplicar toda esta lógica de "leer sesión → cargar perfil →
        // decidir qué pantalla mostrar" para el caso del popup.
        // FIX (2026-08-09): antes este bloque de "entrar con el perfil
        // cacheado cuando no hay internet" solo existía UNA vez, más abajo,
        // para cuando obtenerMiPerfilApp() fallaba por conexión - pero la
        // llamada a getSession() de más arriba podía fallar por la MISMA
        // razón (sin internet justo cuando toca renovar un token vencido) y
        // no tenía ningún respaldo. Se separa en función aparte para
        // reusarla en los dos puntos donde puede fallar por conexión.

        // FIX-VELOCIDAD-2 (2026-08-09), CORREGIDO (2026-08-09, bug real
        // reportado con foto: franja roja "Sin conexión" apareciendo CON
        // conexión real, wifi/datos con buena señal): el valor original de
        // 1.2s por llamada era demasiado agresivo para una red móvil real
        // (datos celulares, wifi público, o el propio Supabase con una
        // conexión "fría") - el tiempo normal de ida y vuelta ahí puede
        // superar 1.2s sin que signifique que falta internet, y al vencer
        // el timeout esErrorDeConexion() lo reconocía como error de
        // conexión (matchea "timeout" en el mensaje) y la app entraba en
        // modo offline igual, mostrando la franja roja de forma falsa.
        // Subido a 5s por llamada: sigue evitando que el splash quede
        // pegado minutos enteros cuando la red está conectada pero sin
        // salida a internet real (el caso que motivó el fix original),
        // pero da margen de sobra a una conexión real aunque lenta.

        // RED DE SEGURIDAD (2026-08-09), CORREGIDO (2026-08-09): subido de
        // 3s a 12s junto con el cambio de arriba - con 2 llamadas
        // secuenciales (getSession() + obtenerMiPerfilApp()) de hasta 5s
        // cada una, un backstop de 3s cortaba una secuencia legítima ANTES
        // de que sus propios timeouts internos llegaran a activarse, lo
        // cual también generaba falsos "sin conexión". Este backstop de
        // 12s queda solo como último respaldo por si algo se cuelga sin
        // fallar (pasa en algunas redes inestables) en vez de dejar el
        // spinner girando indefinidamente.

        // RED DE SEGURIDAD (2026-08-09): antes esta llamada no tenía ningún
        // .catch() - si CUALQUIER cosa dentro de procesarSesionYMostrarPantalla
        // lanzaba un error no previsto (no solo el de getSession() ya
        // arreglado arriba), la promesa quedaba rechazada sin atrapar y la
        // app se quedaba pegada para siempre en el spinner de arranque
        // (#arranque-splash), exactamente el síntoma reportado ("2 pantallas
        // de carga que se quedan trabadas" al abrir sin internet). Ahora,
        // pase lo que pase (incluido que se cuelgue sin fallar), como último
        // recurso se entra con el perfil cacheado si hay uno (modo offline)
        // o se manda al login - nunca se deja el spinner girando sin salida.
        conTimeoutArranque(procesarSesionYMostrarPantalla(), 12000).catch((err) => {
            console.error('Error inesperado (o timeout) al iniciar la app:', err);
            if (!(esErrorDeConexion(err) && entrarModoOfflineConPerfilCacheado())) {
                showLoginScreen();
            }
        });
