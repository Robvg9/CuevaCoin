/** Fase 3 / Oleada 7 — Estado visto / dots de chat */

export function chatVistoStorageKey(usuarioId) {
    return `cuevacoin_chat_visto_${usuarioId}`;
}

export function leerChatVisto(usuarioId) {
    try {
        return JSON.parse(localStorage.getItem(window.chatVistoStorageKey(usuarioId)) || '{}');
    } catch (e) {
        return {};
    }
}

export function marcarChatTabComoVisto(rol, tab) {
    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    if (!usuarioActual) return;
    const visto = window.leerChatVisto(usuarioActual.id);
    visto[tab] = new Date().toISOString();
    localStorage.setItem(window.chatVistoStorageKey(usuarioActual.id), JSON.stringify(visto));
    const dot = document.getElementById(`${rol}-chat-dot-${tab}`);
    if (dot) dot.classList.add('hidden');
    window.actualizarDotSidebarChat(rol);
}

export function marcarChatTabConNovedad(rol, tab) {
    const dot = document.getElementById(`${rol}-chat-dot-${tab}`);
    if (dot) dot.classList.remove('hidden');
    window.actualizarDotSidebarChat(rol);
}

export function actualizarDotSidebarChat(rol) {
    const tabs = rol === 'admin' ? ['soporte', 'grupal'] : ['soporte', 'grupal', 'privado'];
    const hayAlguna = tabs.some(t => {
        const dot = document.getElementById(`${rol}-chat-dot-${t}`);
        return dot && !dot.classList.contains('hidden');
    });
    const dotSidebar = document.getElementById('chat-mensajes-dot');
    if (dotSidebar) dotSidebar.classList.toggle('hidden', !hayAlguna);
}

export function chatContactoVistoStorageKey(usuarioId, tipoChat) {
    return `cuevacoin_chat_contacto_visto_${tipoChat}_${usuarioId}`;
}

export function leerChatContactoVisto(usuarioId, tipoChat) {
    try {
        return JSON.parse(localStorage.getItem(window.chatContactoVistoStorageKey(usuarioId, tipoChat)) || '{}');
    } catch (e) {
        return {};
    }
}

export function marcarContactoChatVisto(tipoVista, contactoId) {
    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    if (!usuarioActual || !contactoId) return;
    const tipoChat = tipoVista === 'admin' ? 'soporte' : 'privado';
    const visto = window.leerChatContactoVisto(usuarioActual.id, tipoChat);
    visto[contactoId] = new Date().toISOString();
    localStorage.setItem(window.chatContactoVistoStorageKey(usuarioActual.id, tipoChat), JSON.stringify(visto));
}

if (typeof window !== 'undefined') {
    window.chatVistoStorageKey = chatVistoStorageKey;
    window.leerChatVisto = leerChatVisto;
    window.marcarChatTabComoVisto = marcarChatTabComoVisto;
    window.marcarChatTabConNovedad = marcarChatTabConNovedad;
    window.actualizarDotSidebarChat = actualizarDotSidebarChat;
    window.chatContactoVistoStorageKey = chatContactoVistoStorageKey;
    window.leerChatContactoVisto = leerChatContactoVisto;
    window.marcarContactoChatVisto = marcarContactoChatVisto;
}
