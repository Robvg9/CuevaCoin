/** Fase 3 / Oleada 8 — loadAdminUsuarios */

export async function loadAdminUsuarios() {
    const filterEstado = document.getElementById('filter-estado').value || 'actuales';
    const incluirArchivadas = filterEstado === 'archivado' || filterEstado === 'todos';
    const usuarios = await obtenerTrabajadoras({ incluirArchivadas });
    const searchTerm = (document.getElementById('search-usuario').value || '').trim().toLowerCase();

    const usuariosFiltrados = usuarios.filter(u => {
        const matchesSearch = (u.nombre && u.nombre.toLowerCase().includes(searchTerm)) || 
                             u.usuario.toLowerCase().includes(searchTerm);
        const matchesEstado = filterEstado === 'todos' ? true
            : filterEstado === 'activo' ? u.estado === 'activo'
            : filterEstado === 'inactivo' ? u.estado === 'inactivo'
            : filterEstado === 'archivado' ? u.estado === 'archivado'
            : u.estado !== 'archivado';
        return matchesSearch && matchesEstado;
    });

    const cardsContainer = document.getElementById('admin-usuarios-cards');
    const vacioMsg = document.getElementById('admin-usuarios-vacio');
    cardsContainer.innerHTML = '';

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
        card.className = 'usuario-card usuario-card-compacto' + (estaArchivado ? ' usuario-card-archivado' : '');
        const correo = u.googleEmail || u.correo || 'Sin correo registrado';
        const ultimaVez = window.formatearUltimaVez(u.ultimaConexion);
        const metaAhorro = u.metaAhorro ? '$' + Number(u.metaAhorro).toFixed(2) : 'Sin fijar';
        card.innerHTML = `
            <div class="usuario-card-header">
                <img class="usuario-card-avatar" src="${u.foto || `https://ui-avatars.com/api/?name=${u.usuario}&background=2563EB&color=fff`}" alt="${u.nombre || u.usuario}">
                <div class="usuario-card-identidad">
                    <div class="usuario-card-nombre">${u.nombre || 'N/A'}</div>
                    <div class="usuario-card-usuario">@${u.usuario}</div>
                </div>
                <span class="usuario-card-estado ${estaArchivado ? 'archivado' : (u.estado === 'activo' ? 'activo' : 'inactivo')}">${estaArchivado ? 'Archivado' : u.estado}</span>
            </div>
            <div class="usuario-card-info">
                <span class="usuario-card-saldo" title="Saldo disponible">$ ${Number(u.saldo).toFixed(2)}</span>
                <span class="usuario-card-correo" title="Correo: ${correo}">✉ ${correo}</span>
            </div>
            <div class="usuario-card-meta">
                <span title="Última conexión: ${ultimaVez}">◷ ${ultimaVez}</span>
                <span title="Meta de ahorro: ${metaAhorro}">🎯 ${metaAhorro}</span>
            </div>
            <div class="usuario-card-acciones">
                <button class="btn btn-secondary" title="Consultar todos los movimientos financieros de este trabajador" onclick="window.abrirHistorialTrabajadoraAdmin('${u.id}')">📜 Historial</button>
                ${estaArchivado
                    ? '<button class="btn btn-secondary" onclick="restaurarUsuario(\'' + u.id + '\')">↩ Restaurar</button>'
                    : '<button class="btn btn-primary" onclick="window.openAjustarSaldoModal(\'' + u.id + '\')">Ajustar</button>' +
                      '<button class="btn ' + (u.estado === 'activo' ? 'btn-danger' : 'btn-secondary') + '" onclick="eliminarUsuario(\'' + u.id + '\')">' + (u.estado === 'activo' ? 'Desactivar' : 'Activar') + '</button>' +
                      '<button class="btn btn-secondary" onclick="archivarUsuario(\'' + u.id + '\')">📦 Archivar</button>'}
            </div>
        `;
        cardsContainer.appendChild(card);
    });
}

if (typeof window !== 'undefined') {
    window.loadAdminUsuarios = loadAdminUsuarios;
}
