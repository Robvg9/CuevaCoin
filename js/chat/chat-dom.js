/** CuevaCoin — js/chat/chat-dom.js
 * Fase 4 — Helpers DOM de mensajes de chat (puro presentacional).
 */

export function crearMensajeChatEl(nombreRemitente, fechaISO, mensajeTexto, esMio, animar, remitenteId, mostrarNombre) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${esMio ? 'sent' : 'received'}${animar ? ' mensaje-nuevo' : ''}`;
    const fechaObj = new Date(fechaISO);
    messageDiv.dataset.dia = fechaObj.toDateString();
    messageDiv.dataset.fechaIso = fechaISO;
    const hora = fechaObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const nombreSeguro = window.escapeHTML(nombreRemitente);
    const nombreHtml = (mostrarNombre && !esMio)
        ? (remitenteId
            ? `<strong class="chat-nombre-clickeable chat-msg-nombre" onclick="verPerfilDesdeChat('${remitenteId}')">${nombreSeguro}</strong>`
            : `<strong class="chat-msg-nombre">${nombreSeguro}</strong>`)
        : '';
    messageDiv.innerHTML = `
        ${nombreHtml}<span class="chat-msg-texto">${window.escapeHTML(mensajeTexto)}</span><span class="chat-msg-hora">${hora}</span>
    `;
    return messageDiv;
}

export function crearSeparadorFechaEl(fechaISO) {
    const div = document.createElement('div');
    div.className = 'chat-date-separator';
    div.dataset.dia = new Date(fechaISO).toDateString();
    div.innerHTML = `<span>${formatearFechaSeparador(fechaISO)}</span>`;
    return div;
}

if (typeof window !== 'undefined') {
    window.crearMensajeChatEl = crearMensajeChatEl;
    window.crearSeparadorFechaEl = crearSeparadorFechaEl;
}
