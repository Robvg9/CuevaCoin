/** Fase 3 / Oleada 7 — Navegación UI de chat */

export function renderizarContactosChat(tipoVista, contactos, mensajeVacio) {
    const cfg = CHAT_LISTA_CONFIG[tipoVista];
    const cont = document.getElementById(cfg.listaContainerId);
    if (!cont) return;
    cont.replaceChildren();

    if (!contactos || contactos.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'chat-lista-vacia-msg';
        empty.textContent = mensajeVacio || 'Todavía no hay contactos disponibles.';
        cont.appendChild(empty);
        return;
    }

    const select = document.getElementById(cfg.selectId);
    const fragment = document.createDocumentFragment();
    contactos.forEach(c => {
        const item = document.createElement('div');
        const activo = String(select.value) === String(c.id);
        item.className = 'chat-contacto-item' + (activo ? ' chat-contacto-activo' : '');
        item.dataset.id = String(c.id);

        const nombre = String(c.nombre || '?');
        const avatar = document.createElement('div');
        avatar.className = 'chat-avatar';
        avatar.textContent = nombre.charAt(0).toUpperCase();

        const info = document.createElement('div');
        info.className = 'chat-contacto-info';
        const nombreEl = document.createElement('div');
        nombreEl.className = 'chat-contacto-nombre';
        nombreEl.appendChild(document.createTextNode(nombre));
        if (c.unread) {
            const dot = document.createElement('span');
            dot.className = 'chat-contacto-dot';
            dot.title = 'Mensaje sin leer';
            nombreEl.appendChild(dot);
        }

        const subtitle = document.createElement('div');
        subtitle.className = 'chat-contacto-subtitulo';
        subtitle.textContent = String(c.subtitulo || '');

        info.appendChild(nombreEl);
        info.appendChild(subtitle);
        item.appendChild(avatar);
        item.appendChild(info);
        item.addEventListener('click', () => window.abrirConversacionChat(tipoVista, c.id));
        fragment.appendChild(item);
    });
    cont.appendChild(fragment);
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
    document.getElementById(cfg.avatarId).textContent = String(nombre).charAt(0).toUpperCase();
    const nombreEl = document.getElementById(cfg.nombreId);
    nombreEl.textContent = nombre;

    // Reemplazamos el listener anterior para que una sincronización frecuente
    // no acumule handlers ni use atributos onclick construidos dinámicamente.
    if (nombreEl.__chatProfileClickHandler) {
        nombreEl.removeEventListener('click', nombreEl.__chatProfileClickHandler);
        nombreEl.__chatProfileClickHandler = null;
    }
    if (cfg.clickeablePerfil) {
        const handler = () => window.verPerfilDesdeChat(select.value);
        nombreEl.addEventListener('click', handler);
        nombreEl.__chatProfileClickHandler = handler;
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
