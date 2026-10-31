/** CuevaCoin — js/chat/chat-dom.js
 * Fase 4 — Helpers DOM de mensajes de chat (puro presentacional).
 */

export function crearMensajeChatEl(nombreRemitente, fechaISO, mensajeTexto, esMio, animar, remitenteId, mostrarNombre) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message ' + (esMio ? 'sent' : 'received')
        + (animar ? ' mensaje-nuevo' : '');

    const fechaObj = new Date(fechaISO);
    messageDiv.dataset.dia = fechaObj.toDateString();
    messageDiv.dataset.fechaIso = fechaISO;
    const hora = fechaObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    if (mostrarNombre && !esMio) {
        const name = document.createElement('strong');
        name.className = 'chat-msg-nombre';
        name.textContent = String(nombreRemitente || 'N/A');
        if (remitenteId) {
            name.classList.add('chat-nombre-clickeable');
            name.addEventListener('click', () => {
                if (typeof window.verPerfilDesdeChat === 'function') {
                    window.verPerfilDesdeChat(String(remitenteId));
                }
            });
        }
        messageDiv.appendChild(name);
    }

    const message = document.createElement('span');
    message.className = 'chat-msg-texto';
    message.textContent = String(mensajeTexto == null ? '' : mensajeTexto);

    const time = document.createElement('span');
    time.className = 'chat-msg-hora';
    time.textContent = hora;

    messageDiv.appendChild(message);
    messageDiv.appendChild(time);
    return messageDiv;
}

export function crearSeparadorFechaEl(fechaISO) {
    const div = document.createElement('div');
    div.className = 'chat-date-separator';
    div.dataset.dia = new Date(fechaISO).toDateString();
    const label = document.createElement('span');
    label.textContent = String(formatearFechaSeparador(fechaISO));
    div.appendChild(label);
    return div;
}

if (typeof window !== 'undefined') {
    window.crearMensajeChatEl = crearMensajeChatEl;
    window.crearSeparadorFechaEl = crearSeparadorFechaEl;
}
