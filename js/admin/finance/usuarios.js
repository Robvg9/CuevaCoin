/** Fase 3 / Oleada 8 — loadAdminUsuarios */

function crearElementoTexto(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? '' : String(value);
    return element;
}

function obtenerAvatarSeguro(foto, nombre) {
    const fallback = 'https://ui-avatars.com/api/?name='
        + encodeURIComponent(String(nombre || 'Usuario'))
        + '&background=2563EB&color=fff';
    if (!foto) return fallback;

    try {
        const base = window.location?.origin || 'https://cuevacoin.invalid';
        const url = new URL(String(foto), base);
        const esHttps = url.protocol === 'https:';
        const esHttpMismoOrigen = url.protocol === 'http:' && url.origin === base;
        return esHttps || esHttpMismoOrigen ? url.href : fallback;
    } catch (_error) {
        return fallback;
    }
}

function crearBotonAccion(label, className, title, accion) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = title || '';
    button.textContent = label;
    button.addEventListener('click', accion);
    return button;
}

export async function loadAdminUsuarios() {
    const filterEstado = document.getElementById('filter-estado').value || 'actuales';
    const incluirArchivadas = filterEstado === 'archivado' || filterEstado === 'todos';
    const usuarios = await obtenerTrabajadoras({ incluirArchivadas });
    const searchTerm = (document.getElementById('search-usuario').value || '').trim().toLowerCase();

    const usuariosFiltrados = usuarios.filter(u => {
        const nombre = String(u.nombre || '').toLowerCase();
        const usuario = String(u.usuario || '').toLowerCase();
        const matchesSearch = nombre.includes(searchTerm) || usuario.includes(searchTerm);
        const matchesEstado = filterEstado === 'todos' ? true
            : filterEstado === 'activo' ? u.estado === 'activo'
            : filterEstado === 'inactivo' ? u.estado === 'inactivo'
            : filterEstado === 'archivado' ? u.estado === 'archivado'
            : u.estado !== 'archivado';
        return matchesSearch && matchesEstado;
    });

    const cardsContainer = document.getElementById('admin-usuarios-cards');
    const vacioMsg = document.getElementById('admin-usuarios-vacio');
    if (!cardsContainer || !vacioMsg) return;
    cardsContainer.replaceChildren();

    if (usuariosFiltrados.length === 0) {
        cardsContainer.classList.add('hidden');
        vacioMsg.classList.remove('hidden');
        return;
    }
    cardsContainer.classList.remove('hidden');
    vacioMsg.classList.add('hidden');

    usuariosFiltrados.forEach(u => {
        const card = document.createElement('div');
        const estaArchivado = u.estado === 'archivado';
        card.className = 'usuario-card usuario-card-compacto'
            + (estaArchivado ? ' usuario-card-archivado' : '');

        const nombre = u.nombre || 'N/A';
        const usuario = u.usuario || '—';
        const correo = u.googleEmail || u.correo || 'Sin correo registrado';
        const ultimaVez = window.formatearUltimaVez(u.ultimaConexion);
        const metaAhorro = u.metaAhorro ? '$' + Number(u.metaAhorro).toFixed(2) : 'Sin fijar';

        const header = document.createElement('div');
        header.className = 'usuario-card-header';

        const avatar = document.createElement('img');
        avatar.className = 'usuario-card-avatar';
        avatar.src = obtenerAvatarSeguro(u.foto, nombre !== 'N/A' ? nombre : usuario);
        avatar.alt = String(nombre !== 'N/A' ? nombre : usuario);
        avatar.loading = 'lazy';

        const identidad = document.createElement('div');
        identidad.className = 'usuario-card-identidad';
        identidad.appendChild(crearElementoTexto('div', 'usuario-card-nombre', nombre));
        identidad.appendChild(crearElementoTexto('div', 'usuario-card-usuario', '@' + usuario));

        const estadoClass = estaArchivado ? 'archivado' : (u.estado === 'activo' ? 'activo' : 'inactivo');
        const estadoLabel = estaArchivado ? 'Archivado' : (u.estado || 'Inactivo');
        const estado = crearElementoTexto('span', 'usuario-card-estado ' + estadoClass, estadoLabel);
        header.appendChild(avatar);
        header.appendChild(identidad);
        header.appendChild(estado);

        const info = document.createElement('div');
        info.className = 'usuario-card-info';
        const saldo = crearElementoTexto('span', 'usuario-card-saldo', Number(u.saldo).toFixed(2));
        saldo.title = 'Saldo disponible';
        const correoEl = crearElementoTexto('span', 'usuario-card-correo', '✉ ' + correo);
        correoEl.title = 'Correo: ' + String(correo);
        info.appendChild(saldo);
        info.appendChild(correoEl);

        const meta = document.createElement('div');
        meta.className = 'usuario-card-meta';
        const ultimaConexionEl = crearElementoTexto('span', '', '◷ ' + ultimaVez);
        ultimaConexionEl.title = 'Última conexión: ' + String(ultimaVez);
        const metaAhorroEl = crearElementoTexto('span', '', '🎯 ' + metaAhorro);
        metaAhorroEl.title = 'Meta de ahorro: ' + String(metaAhorro);
        meta.appendChild(ultimaConexionEl);
        meta.appendChild(metaAhorroEl);

        const acciones = document.createElement('div');
        acciones.className = 'usuario-card-acciones';
        acciones.appendChild(crearBotonAccion(
            '📜 Historial',
            'btn btn-secondary',
            'Consultar todos los movimientos financieros de este trabajador',
            () => {
                if (typeof window.abrirHistorialTrabajadoraAdmin === 'function') {
                    window.abrirHistorialTrabajadoraAdmin(u.id);
                }
            }
        ));

        if (estaArchivado) {
            acciones.appendChild(crearBotonAccion('↩ Restaurar', 'btn btn-secondary', '',
                () => {
                    if (typeof window.restaurarUsuario === 'function') window.restaurarUsuario(u.id);
                }));
        } else {
            acciones.appendChild(crearBotonAccion('Ajustar', 'btn btn-primary', '',
                () => {
                    if (typeof window.openAjustarSaldoModal === 'function') window.openAjustarSaldoModal(u.id);
                }));
            acciones.appendChild(crearBotonAccion(
                u.estado === 'activo' ? 'Desactivar' : 'Activar',
                'btn ' + (u.estado === 'activo' ? 'btn-danger' : 'btn-secondary'),
                '',
                () => {
                    if (typeof window.eliminarUsuario === 'function') window.eliminarUsuario(u.id);
                }
            ));
            acciones.appendChild(crearBotonAccion('📦 Archivar', 'btn btn-secondary', '',
                () => {
                    if (typeof window.archivarUsuario === 'function') window.archivarUsuario(u.id);
                }));
        }

        card.appendChild(header);
        card.appendChild(info);
        card.appendChild(meta);
        card.appendChild(acciones);
        cardsContainer.appendChild(card);
    });
}

if (typeof window !== 'undefined') {
    window.loadAdminUsuarios = loadAdminUsuarios;
}
