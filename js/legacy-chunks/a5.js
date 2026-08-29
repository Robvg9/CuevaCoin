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
