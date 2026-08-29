/** Fase 3 / Oleada 7 — Navegación UI de chat */

export function renderizarContactosChat(tipoVista, contactos, mensajeVacio) {
    const cfg = CHAT_LISTA_CONFIG[tipoVista];
    const cont = document.getElementById(cfg.listaContainerId);
    if (contactos.length === 0) {
        cont.innerHTML = `<p class="chat-lista-vacia-msg">${mensajeVacio || 'Todavía no hay contactos disponibles.'}</p>`;
        return;
    }
    const select = document.getElementById(cfg.selectId);
    cont.innerHTML = '';
    contactos.forEach(c => {
        const item = document.createElement('div');
        const activo = String(select.value) === String(c.id);
        item.className = 'chat-contacto-item' + (activo ? ' chat-contacto-activo' : '');
        item.dataset.id = c.id;
        const inicial = (c.nombre || '?').charAt(0).toUpperCase();
        // v107: burbujita de "sin leer" por contacto (además del
        // orden ya aplicado antes de llegar acá, que puso a este
        // contacto arriba si corresponde).
        item.innerHTML = `
            <div class="chat-avatar">${inicial}</div>
            <div class="chat-contacto-info">
                <div class="chat-contacto-nombre">${c.nombre}${c.unread ? ' <span class="chat-contacto-dot" title="Mensaje sin leer"></span>' : ''}</div>
                <div class="chat-contacto-subtitulo">${c.subtitulo || ''}</div>
            </div>
        `;
        item.addEventListener('click', () => window.abrirConversacionChat(tipoVista, c.id));
        cont.appendChild(item);
    });
}

export function sincronizarVistaChatSegunSeleccion(tipoVista) {
    const cfg = CHAT_LISTA_CONFIG[tipoVista];
    const select = document.getElementById(cfg.selectId);
    const listaEl = document.getElementById(cfg.listaContainerId);
    if (listaEl) {
        listaEl.querySelectorAll('.chat-contacto-item').forEach(el => {
            el.classList.toggle('chat-contacto-activo', el.dataset.id === String(select.value));
        });
    }
    const conversacionEl = document.getElementById(cfg.conversacionId);
    const listaWrapEl = document.getElementById(cfg.listaWrapId);
    if (!select.value) {
        conversacionEl.classList.add('hidden');
        listaWrapEl.classList.remove('hidden');
        return;
    }
    const opcion = select.options[select.selectedIndex];
    const nombre = (opcion && (opcion.dataset.nombre || opcion.text)) || 'Contacto';
    document.getElementById(cfg.avatarId).textContent = nombre.charAt(0).toUpperCase();
    const nombreEl = document.getElementById(cfg.nombreId);
    nombreEl.textContent = nombre;
    if (cfg.clickeablePerfil) {
        nombreEl.onclick = () => verPerfilDesdeChat(select.value);
    }
    conversacionEl.classList.remove('hidden');
    listaWrapEl.classList.add('hidden');
}

export function abrirConversacionChat(tipoVista, id) {
    const cfg = CHAT_LISTA_CONFIG[tipoVista];
    const select = document.getElementById(cfg.selectId);
    // v107: apenas se abre la conversación con este contacto, se
    // marca como visto para que la burbujita se apague (el
    // reordenamiento hacia su lugar alfabético pasa la próxima vez
    // que se recargue la lista, ej. al volver a esta pestaña).
    window.marcarContactoChatVisto(tipoVista, id);
    const item = document.querySelector(`#${cfg.listaContainerId} .chat-contacto-item[data-id="${CSS.escape(String(id))}"]`);
    if (item) {
        const dot = item.querySelector('.chat-contacto-dot');
        if (dot) dot.remove();
    }
    if (String(select.value) !== String(id)) {
        select.value = id;
        select.dispatchEvent(new Event('change'));
    } else {
        window.sincronizarVistaChatSegunSeleccion(tipoVista);
    }
}

export function volverListaChat(tipoVista) {
    const cfg = CHAT_LISTA_CONFIG[tipoVista];
    document.getElementById(cfg.conversacionId).classList.add('hidden');
    document.getElementById(cfg.listaWrapId).classList.remove('hidden');
}

export function cambiarTabChat(rol, tab, preseleccionarId) {
    const tabsDisponibles = rol === 'admin' ? ['soporte', 'grupal'] : ['soporte', 'grupal', 'privado'];
    tabsDisponibles.forEach(t => {
        const panel = document.getElementById(`${rol}-chat-panel-${t}`);
        const boton = document.getElementById(`${rol}-chat-tab-btn-${t}`);
        if (panel) panel.classList.toggle('hidden', t !== tab);
        if (boton) boton.classList.toggle('chat-tab-activa', t === tab);
    });
    if (tab === 'grupal') {
        window.loadGrupalChat(rol);
    } else if (tab === 'privado') {
        window.loadContactosPrivado(preseleccionarId);
    }
}

if (typeof window !== 'undefined') {
    window.renderizarContactosChat = renderizarContactosChat;
    window.sincronizarVistaChatSegunSeleccion = sincronizarVistaChatSegunSeleccion;
    window.abrirConversacionChat = abrirConversacionChat;
    window.volverListaChat = volverListaChat;
    window.cambiarTabChat = cambiarTabChat;
}
