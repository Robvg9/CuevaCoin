/** Fase 3 / Oleada 7 — Realtime chat channels */

export function suscribirRealtimeChatAdmin(adminId) {
    if (window.chatRealtimeChannel) {
        window.supabaseClient.removeChannel(window.chatRealtimeChannel);
        window.chatRealtimeChannel = null;
    }
    window.chatRealtimeChannel = window.supabaseClient
        .channel(`chat-admin-${adminId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'chat',
            filter: `destinatario_id=eq.${adminId}`
        }, (payload) => {
            const destinatarioSelect = document.getElementById('admin-chat-destinatario');
            const conversacionAbierta = destinatarioSelect && destinatarioSelect.value === payload.new.remitente_id;
            const seccionChatVisible = !document.getElementById('admin-chat').classList.contains('hidden');
            if (conversacionAbierta && seccionChatVisible) {
                // Antes esto llamaba a window.loadAdminChat() (recargaba TODA
                // la conversación), lo que reseteaba el scroll al
                // principio del chat cada vez que llegaba un mensaje
                // — bug reportado por el usuario. Ahora se agrega
                // solo el mensaje nuevo al final, con animación, y el
                // scroll baja solo si el admin ya estaba mirando lo
                // último (window.chatEstabaAlFondo).
                const opcionSel = destinatarioSelect.options[destinatarioSelect.selectedIndex];
                const nombreOpcion = opcionSel?.dataset.nombre || opcionSel?.text || 'Trabajador';
                const messagesContainer = document.getElementById('admin-chat-messages');
                window.agregarMensajeYScroll(messagesContainer, window.crearMensajeChatEl(nombreOpcion, payload.new.creado_en, payload.new.mensaje, false, true, payload.new.remitente_id, false));
            } else {
                // Es de otro trabajador o el admin no está mirando el
                // chat en este momento: solo avisar con un toast, sin
                // tocar la conversación que tenga abierta.
                window.showToast('Nuevo mensaje de chat de un trabajador', 3000);
                window.marcarChatTabConNovedad('admin', 'soporte');
                // v107: refresca la lista de contactos para que la
                // burbujita nueva y el reordenamiento se vean ya,
                // sin esperar a que el admin cambie de pestaña.
                window.loadChatDestinatarios();
            }
        })
        .subscribe((status, err) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                console.error('Realtime chat (admin) no se pudo suscribir:', status, err);
            }
        });
}

export function suscribirRealtimeChatUsuario(usuarioId) {
    if (window.chatRealtimeChannel) {
        window.supabaseClient.removeChannel(window.chatRealtimeChannel);
        window.chatRealtimeChannel = null;
    }
    window.chatRealtimeChannel = window.supabaseClient
        .channel(`chat-usuario-${usuarioId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'chat',
            filter: `destinatario_id=eq.${usuarioId}`
        }, (payload) => {
            // Punto 38b (2026-08-03): este filtro (destinatario_id=eq)
            // también recibe los mensajes de chat PRIVADO dirigidos a
            // este trabajador, no solo los de soporte del admin — se
            // distingue por payload.new.tipo.
            if (payload.new.tipo === 'privado') {
                const select = document.getElementById('user-chat-privado-destinatario');
                const panelVisible = !document.getElementById('user-chat-panel-privado').classList.contains('hidden');
                const seccionChatVisible = !document.getElementById('user-chat').classList.contains('hidden');
                const conversacionAbierta = select && select.value === payload.new.remitente_id;
                if (seccionChatVisible && panelVisible && conversacionAbierta) {
                    const opcionSel = select.options[select.selectedIndex];
                    const nombreOpcion = opcionSel?.dataset.nombre || opcionSel?.text || 'Compañera';
                    const messagesContainer = document.getElementById('user-chat-privado-messages');
                    window.agregarMensajeYScroll(messagesContainer, window.crearMensajeChatEl(nombreOpcion, payload.new.creado_en, payload.new.mensaje, false, true, payload.new.remitente_id, false));
                } else {
                    window.showToast('Nuevo mensaje privado', 3000);
                    window.marcarChatTabConNovedad('user', 'privado');
                    // v107: mismo refresco que del lado del admin.
                    window.loadContactosPrivado();
                }
                return;
            }
            // tipo === 'soporte' (comportamiento ya existente, sin cambios,
            // solo ahora también revisa que la pestaña Soporte esté activa).
            const seccionChatVisible = !document.getElementById('user-chat').classList.contains('hidden');
            const panelSoporteVisible = !document.getElementById('user-chat-panel-soporte').classList.contains('hidden');
            if (seccionChatVisible && panelSoporteVisible) {
                // Mismo fix que del lado del admin: agregar solo el
                // mensaje nuevo, con animación, sin recargar toda la
                // conversación (evita el salto al principio).
                const messagesContainer = document.getElementById('user-chat-messages');
                window.agregarMensajeYScroll(messagesContainer, window.crearMensajeChatEl('Soporte Técnico', payload.new.creado_en, payload.new.mensaje, false, true, null, false));
            } else {
                window.showToast('Nuevo mensaje de Soporte Técnico', 3000);
                window.marcarChatTabConNovedad('user', 'soporte');
            }
        })
        .subscribe((status, err) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                console.error('Realtime chat (usuario) no se pudo suscribir:', status, err);
            }
        });
}

export function suscribirRealtimeChatGrupal(rol, usuarioId) {
    if (window.chatGrupalRealtimeChannel) {
        window.supabaseClient.removeChannel(window.chatGrupalRealtimeChannel);
        window.chatGrupalRealtimeChannel = null;
    }
    window.chatGrupalRealtimeChannel = window.supabaseClient
        .channel(`chat-grupal-${usuarioId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'chat',
            filter: `tipo=eq.grupal`
        }, async (payload) => {
            if (payload.new.remitente_id === usuarioId) return; // ya se vio al mandarlo
            const panel = document.getElementById(`${rol}-chat-panel-grupal`);
            const seccionVisible = !document.getElementById(`${rol}-chat`).classList.contains('hidden');
            const panelVisible = panel && !panel.classList.contains('hidden');
            if (!seccionVisible || !panelVisible) {
                window.showToast('Nuevo mensaje en el chat grupal', 3000);
                window.marcarChatTabConNovedad(rol, 'grupal');
                return;
            }
            // El evento de Realtime no trae el nombre del remitente (no
            // hace join), así que se busca aparte — mismo criterio que
            // el resto del chat: nunca recargar toda la conversación
            // solo para mostrar un mensaje nuevo (resetearía el scroll).
            const { data: remitente } = await window.supabaseClient
                .from('perfiles')
                .select('nombre, usuario')
                .eq('id', payload.new.remitente_id)
                .single();
            const nombreRemitente = remitente ? (remitente.nombre || remitente.usuario) : 'Compañera';
            const messagesContainer = document.getElementById(`${rol}-chat-grupal-messages`);
            window.agregarMensajeYScroll(messagesContainer, window.crearMensajeChatEl(nombreRemitente, payload.new.creado_en, payload.new.mensaje, false, true, payload.new.remitente_id, true));
        })
        .subscribe((status, err) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                console.error('Realtime chat grupal no se pudo suscribir:', status, err);
            }
        });
}

if (typeof window !== 'undefined') {
    window.suscribirRealtimeChatAdmin = suscribirRealtimeChatAdmin;
    window.suscribirRealtimeChatUsuario = suscribirRealtimeChatUsuario;
    window.suscribirRealtimeChatGrupal = suscribirRealtimeChatGrupal;
}
