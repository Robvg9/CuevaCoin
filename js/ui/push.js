/**
 * CuevaCoin — js/ui/push.js
 * Activación y estado de Web Push (Oleada 3).
 * No incluye notificaciones de retiro ni cola.
 */

export async function sincronizarSuscripcionPush(usuarioId) {
    try {
        if (!usuarioId) return;
        if (!window.isSecureContext) return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        if (Notification.permission !== 'granted') return; // no insistir sin permiso ya dado antes

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            // El permiso ya estaba concedido de una vez anterior:
            // subscribe() acá NO vuelve a preguntar nada, solo
            // recrea la suscripción que se había perdido.
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: window.urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY),
            });
        }

        const subJson = subscription.toJSON();
        const { error } = await window.supabaseClient
            .from('push_suscripciones')
            .insert({
                usuario_id: usuarioId,
                endpoint: subJson.endpoint,
                p256dh: subJson.keys.p256dh,
                auth: subJson.keys.auth,
            });
        if (error && error.code === '23505') {
            // Ya existía esa suscripción (mismo endpoint): la
            // actualizamos para que quede atada al usuario en
            // sesión actual (por si el dispositivo cambió de
            // cuenta) con las claves más recientes.
            const { error: errorUpdate } = await window.supabaseClient
                .from('push_suscripciones')
                .update({ usuario_id: usuarioId, p256dh: subJson.keys.p256dh, auth: subJson.keys.auth })
                .eq('endpoint', subJson.endpoint);
            if (errorUpdate) console.error('Error actualizando suscripción push existente:', errorUpdate);
        } else if (error) {
            console.error('Error resincronizando suscripción push:', error);
        }
    } catch (err) {
        // Intento silencioso de fondo - si falla, no se molesta al
        // usuario con nada. window.actualizarEstadoBotonPush() sigue
        // ofreciendo el botón manual como respaldo.
        console.error('sincronizarSuscripcionPush falló:', err);
    }
}

export async function actualizarEstadoBotonPush() {
    const btns = document.querySelectorAll('.js-btn-activar-push');
    const msgs = document.querySelectorAll('.js-push-status-msg');
    // Punto 12 (2026-08-08): a diferencia del botón de Configuración
    // (que nunca desaparece, solo cambia de texto entre "Activar" y
    // "Actualizar"), este banner de Inicio debe desaparecer del todo
    // en cuanto el dispositivo ya tiene las notificaciones activadas
    // - se controla aparte, no con setEstado().
    const bannerInicio = document.getElementById('promo-activar-notificaciones-banner');
    if (btns.length === 0 && !bannerInicio) return;

    function setEstado({ ocultarBoton, texto, esError }) {
        btns.forEach(b => b.classList.toggle('hidden', ocultarBoton));
        msgs.forEach(m => {
            if (texto) {
                m.textContent = texto;
                m.classList.remove('hidden');
                m.style.fontWeight = esError ? '600' : 'normal';
                m.style.color = esError ? '#DC2626' : 'inherit';
                m.style.opacity = esError ? '1' : '0.8';
            } else {
                m.classList.add('hidden');
            }
        });
    }

    // Salvavidas: si algo se cuelga más abajo (por ejemplo
    // navigator.serviceWorker.ready que nunca resuelve porque el
    // archivo /service-worker.js no se pudo registrar en el
    // hosting), después de 6 segundos mostramos igual el botón
    // con un aviso de error en vez de dejarlo invisible/colgado
    // sin explicación (bug B1 reportado 2026-08-02).
    let resuelto = false;
    const timeoutSalvavidas = setTimeout(() => {
        if (resuelto) return;
        resuelto = true;
        console.error('actualizarEstadoBotonPush: se agotó el tiempo esperando el Service Worker. Revisa que /service-worker.js exista de verdad en la raíz del sitio y que la consola no muestre "ServiceWorker registration failed".');
        setEstado({
            ocultarBoton: false,
            texto: '⚠️ No se pudo verificar el estado de las notificaciones (el Service Worker tardó demasiado en responder). Podés intentar tocar el botón igual, o avisar al desarrollador si sigue sin funcionar.',
            esError: true,
        });
        if (bannerInicio) bannerInicio.classList.add('hidden');
    }, 6000);

    // content:// o file:// (abrir el HTML directo desde el celular, sin
    // servidor) NO son "contextos seguros": el navegador bloquea la API
    // de push aunque exista. Avisar esto claramente en vez de dejar que
    // parezca que el usuario hizo algo mal.
    if (!window.isSecureContext) {
        resuelto = true;
        clearTimeout(timeoutSalvavidas);
        setEstado({
            ocultarBoton: true,
            texto: '⚠️ Las notificaciones push solo funcionan cuando la app está en un sitio con HTTPS (o instalada como PWA), no abriendo el archivo directo. Pídele a tu desarrollador que la suba a un hosting.',
            esError: true,
        });
        if (bannerInicio) bannerInicio.classList.add('hidden');
        return;
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        resuelto = true;
        clearTimeout(timeoutSalvavidas);
        setEstado({ ocultarBoton: true, texto: 'Este navegador no soporta notificaciones push.', esError: true });
        if (bannerInicio) bannerInicio.classList.add('hidden');
        return;
    }

    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (resuelto) return; // el salvavidas ya actuó, no lo pises
        resuelto = true;
        clearTimeout(timeoutSalvavidas);
        if (subscription) {
            setEstado({ ocultarBoton: false, texto: '🔔 Notificaciones activadas en este dispositivo. Si las instalaste ANTES de agregar la app a tu pantalla de inicio, tocá el botón para actualizarlas.' });
            btns.forEach(b => { b.textContent = '🔄 Actualizar notificaciones'; });
            if (bannerInicio) bannerInicio.classList.add('hidden');
        } else {
            setEstado({ ocultarBoton: false, texto: null });
            btns.forEach(b => { b.textContent = '🔔 Activar notificaciones en este dispositivo'; });
            if (bannerInicio) bannerInicio.classList.remove('hidden');
        }
    } catch (err) {
        if (resuelto) return;
        resuelto = true;
        clearTimeout(timeoutSalvavidas);
        console.error('Error revisando suscripción push:', err);
        setEstado({
            ocultarBoton: false,
            texto: '⚠️ Hubo un error revisando el estado de las notificaciones (ver consola). Podés intentar activar igual.',
            esError: true,
        });
        // No se sabe con certeza si está activado o no - se deja el
        // banner oculto para no invitar a tocar algo que podría
        // fallar de nuevo por el mismo error.
        if (bannerInicio) bannerInicio.classList.add('hidden');
    }
}

// Pide permiso de notificaciones, crea la suscripción push del navegador
// y la guarda en Supabase (tabla push_suscripciones) asociada al usuario
// en sesión. Con esto queda lista la mitad "recibir" del sistema; falta

export async function activarNotificacionesPush() {
    if (!window.requiereConexionParaOperar()) return;
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));

    if (!usuario) {
        window.showToast('Debes iniciar sesión primero', 3000);
        return;
    }

    // Mismo chequeo que window.actualizarEstadoBotonPush(): si no es un contexto
    // seguro, ni siquiera intentamos pedir permiso — el navegador lo
    // negaría solo, sin preguntarle nada al usuario, y eso confunde.
    if (!window.isSecureContext) {
        window.showToast('Las notificaciones solo funcionan en un sitio con HTTPS, no abriendo el archivo directo desde el celular', 6000);
        return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        window.showToast('Este navegador no soporta notificaciones push', 4000);
        return;
    }

    try {
        const permiso = await Notification.requestPermission();
        if (permiso !== 'granted') {
            window.showToast('No diste permiso de notificaciones, no se pudo activar', 4000);
            return;
        }

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            // Ya había una suscripción (quizás vieja, de antes de instalar
            // la app como PWA). La tiramos y creamos una nueva de cero para
            // asegurarnos de que quede atada al contexto actual, no al viejo.
            await subscription.unsubscribe();
            subscription = null;
        }
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: window.urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY),
        });

        const subJson = subscription.toJSON();
        const { error } = await window.supabaseClient
            .from('push_suscripciones')
            .insert({
                usuario_id: usuario.id,
                endpoint: subJson.endpoint,
                p256dh: subJson.keys.p256dh,
                auth: subJson.keys.auth,
            });

        // Si ya existía esta misma suscripción (endpoint UNIQUE), no es un
        // error real para el usuario, solo significa que ya estaba activada.
        if (error && error.code !== '23505') {
            console.error('Error guardando suscripción push:', error);
            window.showToast('No se pudo activar las notificaciones, intenta de nuevo', 4000);
            return;
        }

        window.showToast('🔔 Notificaciones activadas en este dispositivo', 3000);
        window.actualizarEstadoBotonPush();
    } catch (err) {
        console.error('Error activando notificaciones push:', err);
        window.showToast('No se pudo activar las notificaciones', 4000);
    }
}

// Punto 23: preferencias de notificaciones (qué eventos mandan push).
// Carga los 5 switches de #shared-config-notificaciones con el valor
// real guardado en perfiles.preferencias_notificaciones del usuario
// que tiene la sesión abierta (admin o trabajador, es la misma
// sección compartida). Si la columna viene null/vacía por algún
// motivo, se asume todo activado (true), que es el default seguro.



if (typeof window !== 'undefined') {
    window.sincronizarSuscripcionPush = sincronizarSuscripcionPush;
    window.actualizarEstadoBotonPush = actualizarEstadoBotonPush;
    window.activarNotificacionesPush = activarNotificacionesPush;
}
