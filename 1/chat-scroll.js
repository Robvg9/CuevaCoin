/** Fase 3 / Oleada 7 — Scroll helpers de mensajes */

export function chatEstabaAlFondo(contenedor) {
    return contenedor.scrollHeight - contenedor.scrollTop - contenedor.clientHeight < 60;
}

export function appendMensajeChat(contenedor, el) {
    const ultimo = contenedor.lastElementChild;
    if (el.dataset.dia && (!ultimo || ultimo.dataset.dia !== el.dataset.dia)) {
        contenedor.appendChild(window.crearSeparadorFechaEl(el.dataset.fechaIso));
    }
    contenedor.appendChild(el);
}

export function agregarMensajeYScroll(contenedor, el) {
    if (contenedor.querySelector('p')) contenedor.innerHTML = '';
    const alFondo = window.chatEstabaAlFondo(contenedor);
    window.appendMensajeChat(contenedor, el);
    if (alFondo) contenedor.scrollTop = contenedor.scrollHeight;
}

if (typeof window !== 'undefined') {
    window.chatEstabaAlFondo = chatEstabaAlFondo;
    window.appendMensajeChat = appendMensajeChat;
    window.agregarMensajeYScroll = agregarMensajeYScroll;
}
