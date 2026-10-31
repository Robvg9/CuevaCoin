/** Fase 3 / Oleada 7 — Carga/envío de mensajes */

function mostrarEstadoChat(container, mensaje, className, tagName = 'p') {
    if (!container) return;
    const estado = document.createElement(tagName);
    if (className) estado.className = className;
    estado.textContent = String(mensaje || '');
    container.replaceChildren(estado);
}

function reiniciarSelectChat(select, etiqueta) {
    if (!select) return;
    const option = document.createElement('option');
    option.value = '';
    option.textContent = String(etiqueta || '');
    select.replaceChildren(option);
}


export async function loadAdminChat() {
    const adminId = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual')).id;
    const messagesContainer = document.getElementById('admin-chat-messages');
    const destinatarioSelect = document.getElementById('admin-chat-destinatario');
    const otroUsuarioId = destinatarioSelect.value;
    // Punto 51: sincroniza la vista (lista de contactos vs.
    // conversación abierta, encabezado con avatar+nombre) con la
    // selección actual del <select> oculto.
    window.sincronizarVistaChatSegunSeleccion('admin');
    messagesContainer.replaceChildren();

    // Punto 18a: chats privados por conversación. Si todavía no
    // hay un trabajador seleccionado (ej. no hay ninguno creado
    // aún), la lista de contactos ya queda visible en su lugar.
    if (!otroUsuarioId) return;

    // Solo los mensajes entre el admin y el usuario seleccionado
    // (en cualquiera de los dos sentidos), no todos los chats.
    const { data: chat, error } = await window.supabaseClient
        .from('chat')
        .select('*, remitente:remitente_id(nombre, usuario)')
        .or(`and(remitente_id.eq.${adminId},destinatario_id.eq.${otroUsuarioId}),and(remitente_id.eq.${otroUsuarioId},destinatario_id.eq.${adminId})`)
        .order('creado_en', { ascending: true });

    if (error) {
        console.error(error);
        mostrarEstadoChat(messagesContainer, 'No se pudo cargar el chat.');
        return;
    }

    if (chat.length === 0) {
        mostrarEstadoChat(messagesContainer, 'Todavía no hay mensajes con este trabajador.');
        return;
    }

    chat.forEach(msg => {
        const esMio = msg.remitente_id === adminId;
        const nombreRemitente = esMio
            ? 'Tú'
            : (msg.remitente ? (msg.remitente.nombre || msg.remitente.usuario) : 'N/A');
        window.appendMensajeChat(messagesContainer, window.crearMensajeChatEl(nombreRemitente, msg.creado_en, msg.mensaje, esMio, false, msg.remitente_id, false));
    });
    // Carga completa (primera vez o cambio de conversación): siempre
    // arranca mostrando lo último, no el principio del chat.
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

export async function sendAdminMessage() {
    if (!window.requiereConexionParaOperar()) return;
    const input = document.getElementById('admin-chat-input');
    const destinatarioSelect = document.getElementById('admin-chat-destinatario');
    const mensaje = input.value.trim();
    const destinatarioId = destinatarioSelect.value;

    if (!mensaje || !destinatarioId) {
        window.showToast('Selecciona un usuario y escribe un mensaje', 3000);
        return;
    }

    const admin = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));

    const { error } = await window.supabaseClient
        .from('chat')
        .insert({
            remitente_id: admin.id,
            destinatario_id: destinatarioId,
            mensaje: mensaje
        });
    if (error) {
        console.error(error);
        window.showToast('No se pudo enviar el mensaje', 3000);
        return;
    }

    // Notificar al trabajador de que llegó un mensaje nuevo de
    // soporte (antes esto no insertaba en notificaciones ni
    // mandaba push).
    const mensajeNotifChatUsuario = `Soporte Técnico te escribió: ${mensaje}`;
    const { error: errorNotifChatUsuario } = await window.supabaseClient
        .from('notificaciones')
        .insert({
            usuario_id: destinatarioId,
            mensaje: mensajeNotifChatUsuario,
            leida: false,
            tipo_evento: 'mensaje_chat'
        });
    if (errorNotifChatUsuario) console.error(errorNotifChatUsuario);

    window.supabaseClient.functions.invoke('enviar-push', {
        body: { usuario_id: destinatarioId, mensaje: mensajeNotifChatUsuario, tipo_evento: 'mensaje_chat' }
    }).catch((err) => console.error('Error mandando push de mensaje de chat:', err));

    input.value = '';
    window.loadAdminChat();
    window.showToast('Mensaje enviado', 2000);
}

export async function loadUserChat(usuarioId) {
    const messagesContainer = document.getElementById('user-chat-messages');
    messagesContainer.replaceChildren();

    // RLS ya limita esto a los chats donde participa el trabajador
    const { data: chat, error } = await window.supabaseClient
        .from('chat')
        .select('*, remitente:remitente_id(nombre, usuario)')
        .or(`remitente_id.eq.${usuarioId},destinatario_id.eq.${usuarioId}`)
        .order('creado_en', { ascending: true });

    if (error) {
        console.error(error);
        mostrarEstadoChat(messagesContainer, 'No se pudo cargar el chat.');
        return;
    }

    chat.forEach(msg => {
        const esMio = msg.remitente_id === usuarioId;
        // Punto 16a: el trabajador nunca ve el nombre real del admin,
        // siempre "Soporte Técnico" fijo (no depende de quién sea el admin).
        const nombreRemitente = esMio
            ? 'Tú'
            : 'Soporte Técnico';
        window.appendMensajeChat(messagesContainer, window.crearMensajeChatEl(nombreRemitente, msg.creado_en, msg.mensaje, esMio, false, null, false));
    });
    // Carga completa: siempre arranca mostrando lo último.
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

export async function sendUserMessage() {
    // Punto 4 (2026-08-08): el chat de Soporte es la ÚNICA vía que le
    // queda a una cuenta desactivada para preguntar el motivo y pedir
    // que la reactiven, así que NO debe pasar por
    // window.requiereConexionParaOperar() (esa función bloquea TODO si
    // window.cuentaDesactivadaGlobal es true) - acá se chequea solo la
    // conexión a internet, no el estado de la cuenta.
    if (!navigator.onLine) {
        window.showToast('❌ No se puede realizar esta operación por falta de Internet', 3500);
        return;
    }
    const input = document.getElementById('user-chat-input');
    const mensaje = input.value.trim();

    if (!mensaje) {
        window.showToast('Escribe un mensaje', 3000);
        return;
    }

    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));

    // Buscar el admin real en Supabase (la policy "cualquiera ve
    // perfiles de admins" permite este SELECT aunque no seas admin)
    const { data: admin, error: errorAdmin } = await window.supabaseClient
        .from('perfiles')
        .select('id, nombre, usuario')
        .eq('es_admin', true)
        .limit(1)
        .single();

    if (errorAdmin || !admin) {
        console.error(errorAdmin);
        window.showToast('No hay un administrador configurado', 3000);
        return;
    }

    const { error } = await window.supabaseClient
        .from('chat')
        .insert({
            remitente_id: usuario.id,
            destinatario_id: admin.id,
            mensaje: mensaje
        });
    if (error) {
        console.error(error);
        window.showToast('No se pudo enviar el mensaje', 3000);
        return;
    }

    // Notificar al admin de que llegó un mensaje nuevo (antes esto
    // no insertaba en la tabla notificaciones ni mandaba push).
    const mensajeNotifChatAdmin = `${usuario.nombre || usuario.usuario} te escribió: ${mensaje}`;
    const { error: errorNotifChatAdmin } = await window.supabaseClient
        .from('notificaciones')
        .insert({
            usuario_id: admin.id,
            mensaje: mensajeNotifChatAdmin,
            leida: false,
            tipo_evento: 'mensaje_chat'
        });
    if (errorNotifChatAdmin) console.error(errorNotifChatAdmin);

    window.supabaseClient.functions.invoke('enviar-push', {
        body: { usuario_id: admin.id, mensaje: mensajeNotifChatAdmin, tipo_evento: 'mensaje_chat' }
    }).catch((err) => console.error('Error mandando push de mensaje de chat:', err));

    input.value = '';
    window.loadUserChat(usuario.id);
    window.showToast('Mensaje enviado al admin', 2000);
}

export async function loadGrupalChat(rol) {
    const messagesContainer = document.getElementById(`${rol}-chat-grupal-messages`);
    messagesContainer.replaceChildren();
    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));

    const { data: mensajes, error } = await window.supabaseClient
        .from('chat')
        .select('*, remitente:remitente_id(nombre, usuario)')
        .eq('tipo', 'grupal')
        .order('creado_en', { ascending: true });

    if (error) {
        console.error(error);
        mostrarEstadoChat(messagesContainer, 'No se pudo cargar el chat grupal.');
        return;
    }
    if (mensajes.length === 0) {
        mostrarEstadoChat(messagesContainer, 'Todavía no hay mensajes en el chat grupal. ¡Escribe el primero!');
    } else {
        mensajes.forEach(msg => {
            const esMio = msg.remitente_id === usuarioActual.id;
            const nombreRemitente = esMio ? 'Tú' : (msg.remitente ? (msg.remitente.nombre || msg.remitente.usuario) : 'N/A');
            window.appendMensajeChat(messagesContainer, window.crearMensajeChatEl(nombreRemitente, msg.creado_en, msg.mensaje, esMio, false, msg.remitente_id, true));
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    window.suscribirRealtimeChatGrupal(rol, usuarioActual.id);
}

export async function sendGrupalMessage(rol) {
    if (!window.requiereConexionParaOperar()) return;
    const input = document.getElementById(`${rol}-chat-grupal-input`);
    const mensaje = input.value.trim();
    if (!mensaje) {
        window.showToast('Escribe un mensaje', 2000);
        return;
    }
    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));

    const { error } = await window.supabaseClient
        .from('chat')
        .insert({ remitente_id: usuarioActual.id, destinatario_id: null, tipo: 'grupal', mensaje: mensaje });
    if (error) {
        console.error(error);
        window.showToast('No se pudo enviar el mensaje', 3000);
        return;
    }
    input.value = '';
    window.loadGrupalChat(rol);

    // Punto 1 (2026-08-09, bug crítico "notificaciones rotas"): a
    // diferencia del chat de Soporte y Privado (que sí avisan con
    // campanita + push), el chat Grupal nunca avisaba a nadie fuera
    // de la pestaña abierta - solo dependía de que el canal de
    // Realtime estuviera vivo en ese momento (mostrarToast en
    // window.suscribirRealtimeChatGrupal). Ahora también deja una
    // notificación real (tabla `notificaciones`) y manda push a
    // TODOS los demás usuarios, mismo patrón que el resto de
    // eventos de chat. La política RLS "notificar mensaje chat
    // grupal" (nueva, ver migración de Supabase) es la que autoriza
    // a un trabajador a insertar una notificación para cualquier
    // otro usuario en este caso puntual - el mensaje grupal ya es
    // visible para todos, así que no hay nada nuevo que se esté
    // exponiendo. Fire-and-forget: no se espera cada insert/push
    // uno por uno para no trabar el envío si algún destinatario
    // puntual falla.
    const nombreRemitenteGrupal = usuarioActual.nombre || usuarioActual.usuario;
    const mensajeNotifGrupal = `${nombreRemitenteGrupal} (grupal): ${mensaje}`;
    window.supabaseClient.from('perfiles').select('id').neq('id', usuarioActual.id).then(({ data: otrosUsuarios, error: errorOtros }) => {
        if (errorOtros || !otrosUsuarios) {
            console.error('Error buscando destinatarios de chat grupal:', errorOtros);
            return;
        }
        otrosUsuarios.forEach((otro) => {
            window.supabaseClient.from('notificaciones').insert({
                usuario_id: otro.id,
                mensaje: mensajeNotifGrupal,
                leida: false,
                tipo_evento: 'mensaje_chat'
            }).then(({ error: errorNotifGrupal }) => {
                if (errorNotifGrupal) console.error('Error insertando notificación de chat grupal:', errorNotifGrupal);
            });
            window.supabaseClient.functions.invoke('enviar-push', {
                body: { usuario_id: otro.id, mensaje: mensajeNotifGrupal, tipo_evento: 'mensaje_chat' }
            }).catch((err) => console.error('Error mandando push de chat grupal a', otro.id, err));
        });
    });
}

export async function loadPrivadoChat() {
    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    const select = document.getElementById('user-chat-privado-destinatario');
    const contraparteId = select.value;
    const messagesContainer = document.getElementById('user-chat-privado-messages');
    // Punto 51: sincroniza lista vs. conversación abierta y el
    // header (avatar + nombre clickeable, punto 41b) según la
    // selección actual del <select> oculto.
    window.sincronizarVistaChatSegunSeleccion('privado');
    mostrarEstadoChat(messagesContainer, 'Cargando mensajes...', 'chat-loading', 'div');

    if (!contraparteId) {
        messagesContainer.replaceChildren();
        return;
    }

    // B5 (2026-08-06): mostrar mensaje de carga inmediato para feedback visual
    // y luego cargar los mensajes. Esto reduce la percepción de lag.
    const { data: chat, error } = await window.supabaseClient
        .from('chat')
        .select('*, remitente:remitente_id(nombre, usuario)')
        .eq('tipo', 'privado')
        .or(`and(remitente_id.eq.${usuarioActual.id},destinatario_id.eq.${contraparteId}),and(remitente_id.eq.${contraparteId},destinatario_id.eq.${usuarioActual.id})`)
        .order('creado_en', { ascending: true });

    if (error) {
        console.error(error);
        mostrarEstadoChat(messagesContainer, 'No se pudo cargar el chat.');
        return;
    }
    if (chat.length === 0) {
        mostrarEstadoChat(messagesContainer, 'Todavía no hay mensajes con esta persona.');
        return;
    }
    chat.forEach(msg => {
        const esMio = msg.remitente_id === usuarioActual.id;
        const nombreRemitente = esMio ? 'Tú' : (msg.remitente ? (msg.remitente.nombre || msg.remitente.usuario) : 'N/A');
        window.appendMensajeChat(messagesContainer, window.crearMensajeChatEl(nombreRemitente, msg.creado_en, msg.mensaje, esMio, false, msg.remitente_id, false));
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

export async function sendPrivadoMessage() {
    if (!window.requiereConexionParaOperar()) return;
    const select = document.getElementById('user-chat-privado-destinatario');
    const contraparteId = select.value;
    const input = document.getElementById('user-chat-privado-input');
    const mensaje = input.value.trim();

    if (!contraparteId) {
        window.showToast('Selecciona primero una persona', 3000);
        return;
    }
    if (!mensaje) {
        window.showToast('Escribe un mensaje', 2000);
        return;
    }

    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));

    const { error } = await window.supabaseClient
        .from('chat')
        .insert({ remitente_id: usuarioActual.id, destinatario_id: contraparteId, tipo: 'privado', mensaje: mensaje });
    if (error) {
        console.error(error);
        window.showToast('No se pudo enviar el mensaje. Recuerda que el chat privado solo se habilita con quien ya te hayas transferido saldo.', 4000);
        return;
    }

    // Avisar a la otra persona (campanita + push), mismo patrón que
    // el resto de eventos de chat (punto 38b + enviar-push v6).
    const nombreRemitente = usuarioActual.nombre || usuarioActual.usuario;
    const mensajeNotifPrivado = `${nombreRemitente} te escribió: ${mensaje}`;
    const { error: errorNotif } = await window.supabaseClient
        .from('notificaciones')
        .insert({ usuario_id: contraparteId, mensaje: mensajeNotifPrivado, leida: false, tipo_evento: 'mensaje_chat' });
    if (errorNotif) console.error(errorNotif);

    window.supabaseClient.functions.invoke('enviar-push', {
        body: { usuario_id: contraparteId, mensaje: mensajeNotifPrivado, tipo_evento: 'mensaje_chat' }
    }).catch((err) => console.error('Error mandando push de mensaje privado:', err));

    input.value = '';
    window.loadPrivadoChat();
}

export async function loadContactosPrivado(preseleccionarId) {
    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    const select = document.getElementById('user-chat-privado-destinatario');
    const valorPrevio = select.value;

    const { data: transferencias, error } = await window.supabaseClient
        .from('transacciones')
        .select('contraparte_id')
        .eq('usuario_id', usuarioActual.id)
        .eq('tipo', 'transferencia')
        .not('contraparte_id', 'is', null);

    if (error) {
        console.error(error);
        reiniciarSelectChat(select, 'No se pudo cargar la lista');
        window.renderizarContactosChat('privado', [], 'No se pudo cargar la lista de contactos.');
        window.sincronizarVistaChatSegunSeleccion('privado');
        return;
    }

    const idsUnicos = [...new Set(transferencias.map(t => t.contraparte_id))];
    reiniciarSelectChat(select, 'Selecciona una persona');

    if (idsUnicos.length === 0) {
        window.renderizarContactosChat('privado', [], 'Todavía no te transferiste dinero con nadie. Envía o recibe una transferencia para desbloquear el chat privado con esa persona.');
        window.sincronizarVistaChatSegunSeleccion('privado');
        return;
    }

    const { data: contactos, error: errorContactos } = await window.supabaseClient
        .from('perfiles')
        .select('id, nombre, usuario, ultima_conexion, preferencias_privacidad')
        .in('id', idsUnicos);
    if (errorContactos) {
        console.error(errorContactos);
        reiniciarSelectChat(select, 'No se pudo cargar la lista');
        window.renderizarContactosChat('privado', [], 'No se pudo cargar la lista de contactos.');
        window.sincronizarVistaChatSegunSeleccion('privado');
        return;
    }

    const contactosBase = [];
    const opcionesPorId = {};
    contactos.forEach(c => {
        const nombreLimpio = c.nombre || c.usuario;
        // Punto 41a/41c: entre trabajadoras "última vez" respeta la
        // privacidad de la OTRA persona (campo ultima_conexion de su
        // preferencias_privacidad) — si lo ocultó, no se muestra acá.
        const mostrarUltimaVez = campoVisiblePorPrivacidad(c, 'ultima_conexion');
        const subtitulo = mostrarUltimaVez ? window.formatearUltimaVez(c.ultima_conexion) : '';
        opcionesPorId[c.id] = { nombreLimpio, subtitulo, mostrarUltimaVez };
        contactosBase.push({ id: c.id, nombre: nombreLimpio, subtitulo });
    });

    // v107: mismo criterio que el chat de soporte del admin - el
    // contacto con mensaje sin leer más reciente sube arriba.
    const resumen = await window.obtenerResumenChatContactos('privado', usuarioActual.id, idsUnicos);
    const contactosConNovedad = window.calcularContactosConNovedad('privado', contactosBase, resumen);

    const contactosParaLista = [];
    contactosConNovedad.forEach(c => {
        const info = opcionesPorId[c.id];
        const option = document.createElement('option');
        option.value = c.id;
        option.dataset.nombre = info.nombreLimpio;
        option.textContent = info.mostrarUltimaVez
            ? `${info.nombreLimpio} · ${info.subtitulo}`
            : info.nombreLimpio;
        select.appendChild(option);
        contactosParaLista.push({ id: c.id, nombre: info.nombreLimpio, subtitulo: info.subtitulo, unread: c.unread });
    });

    // Si ya había una conversación abierta y esa persona sigue
    // siendo un contacto válido, mantenerla seleccionada en vez de
    // resetear a "Selecciona una persona" cada vez que se recarga
    // la lista (por ejemplo al volver a esta pestaña).
    // Si viene un id a preseleccionar (ej. desde el modal de
    // felicitación del punto 43), tiene prioridad sobre mantener
    // la selección previa.
    if (preseleccionarId && idsUnicos.includes(preseleccionarId)) {
        select.value = preseleccionarId;
    } else if (valorPrevio && idsUnicos.includes(valorPrevio)) {
        select.value = valorPrevio;
    }
    window.renderizarContactosChat('privado', contactosParaLista);
    window.loadPrivadoChat();
}

export function loadChatDestinatarios(usuariosYaCargados) {
    const render = async (usuariosOriginal) => {
        const select = document.getElementById('admin-chat-destinatario');
        const seleccionPrevia = select.value;
        const adminActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));

        // v107: trae quién tiene mensajes sin ver y reordena poniendo
        // el chat sin leer más reciente arriba de todo.
        const resumen = adminActual
            ? await window.obtenerResumenChatContactos('soporte', adminActual.id, usuariosOriginal.map(u => u.id))
            : {};
        const usuarios = window.calcularContactosConNovedad('admin', usuariosOriginal, resumen);

        reiniciarSelectChat(select, 'Selecciona un usuario');
        usuarios.forEach(u => {
            const option = document.createElement('option');
            option.value = u.id;
            const nombreLimpio = u.nombre || u.usuario;
            // Punto 41a: el admin ve "última vez" de cualquier
            // trabajadora sin importar su privacidad (bypass de
            // privacidad para el admin, mismo criterio que la ficha
            // completa del punto 41b). dataset.nombre guarda el
            // nombre limpio, sin el sufijo, para usarlo en las
            // burbujas de chat (ahí no debe aparecer "última vez").
            option.dataset.nombre = nombreLimpio;
            option.textContent = `${nombreLimpio} · ${window.formatearUltimaVez(u.ultimaConexion)}`;
            select.appendChild(option);
        });
        // Punto 18a: mantener la conversación abierta si el usuario
        // seleccionado sigue existiendo; si no había ninguno
        // seleccionado, elegir el primer trabajador por defecto
        // (para que el admin siempre vea una conversación, no un
        // feed mezclado de todos).
        const sigueExistiendo = usuarios.some(u => String(u.id) === String(seleccionPrevia));
        if (sigueExistiendo) {
            select.value = seleccionPrevia;
        } else if (usuarios.length > 0) {
            select.value = usuarios[0].id;
        }
        // Punto 51 + v107: lista de contactos visual (mismo dato que
        // el <select>, ya reordenado, más .unread para la burbujita).
        window.renderizarContactosChat('admin', usuarios.map(u => ({
            id: u.id,
            nombre: u.nombre || u.usuario,
            subtitulo: window.formatearUltimaVez(u.ultimaConexion),
            unread: u.unread
        })), 'Todavía no hay trabajadoras registradas.');
        // Si la sección de chat del admin está visible ahora mismo,
        // refrescar la conversación con la selección actual.
        const seccionChat = document.getElementById('admin-chat');
        if (seccionChat && !seccionChat.classList.contains('hidden')) {
            window.loadAdminChat();
        } else {
            window.sincronizarVistaChatSegunSeleccion('admin');
        }
    };
    if (usuariosYaCargados) {
        render(usuariosYaCargados);
    } else {
        window.obtenerTrabajadoras().then(render);
    }
}

if (typeof window !== 'undefined') {
    window.loadAdminChat = loadAdminChat;
    window.sendAdminMessage = sendAdminMessage;
    window.loadUserChat = loadUserChat;
    window.sendUserMessage = sendUserMessage;
    window.loadGrupalChat = loadGrupalChat;
    window.sendGrupalMessage = sendGrupalMessage;
    window.loadPrivadoChat = loadPrivadoChat;
    window.sendPrivadoMessage = sendPrivadoMessage;
    window.loadContactosPrivado = loadContactosPrivado;
    window.loadChatDestinatarios = loadChatDestinatarios;
}
