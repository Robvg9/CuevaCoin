/** Fase 3 / Oleada 8 — loadAdminUsuarios */

export async function loadAdminUsuarios() {
    const usuarios = await obtenerTrabajadoras();
    const searchTerm = document.getElementById('search-usuario').value.toLowerCase();
    const filterEstado = document.getElementById('filter-estado').value;

    const usuariosFiltrados = usuarios.filter(u => {
        const matchesSearch = (u.nombre && u.nombre.toLowerCase().includes(searchTerm)) || 
                             u.usuario.toLowerCase().includes(searchTerm);
        const matchesEstado = !filterEstado || u.estado === filterEstado;
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
        card.className = 'usuario-card';
        card.innerHTML = `
            <div class="usuario-card-header">
                <img class="usuario-card-avatar" src="${u.foto || `https://ui-avatars.com/api/?name=${u.usuario}&background=2563EB&color=fff`}" alt="${u.nombre || u.usuario}">
                <div>
                    <div class="usuario-card-nombre">${u.nombre || 'N/A'}</div>
                    <div class="usuario-card-usuario">${u.usuario}</div>
                </div>
                <span class="usuario-card-estado ${u.estado === 'activo' ? 'activo' : 'inactivo'}">${u.estado}</span>
            </div>
            <div class="usuario-card-detalles">
                <span class="usuario-card-saldo">$${Number(u.saldo).toFixed(2)}</span>
                <span>Correo: ${u.googleEmail || u.correo || 'Sin correo registrado'}</span>
                <span>Última vez: ${window.formatearUltimaVez(u.ultimaConexion)}</span>
                <span>Meta de ahorro: ${u.metaAhorro ? '$' + Number(u.metaAhorro).toFixed(2) : 'Sin fijar'}</span>
            </div>
            <div class="usuario-card-acciones">
                <button class="btn btn-secondary" title="Consultar todos los movimientos financieros de este trabajador" onclick="window.abrirHistorialTrabajadoraAdmin('${u.id}')">📜 Historial</button>
                <button class="btn btn-primary" onclick="window.openAjustarSaldoModal('${u.id}')">Ajustar</button>
                <button class="btn ${u.estado === 'activo' ? 'btn-danger' : 'btn-secondary'}" onclick="eliminarUsuario('${u.id}')">${u.estado === 'activo' ? 'Desactivar' : 'Activar'}</button>
            </div>
        `;
        cardsContainer.appendChild(card);
    });
}

if (typeof window !== 'undefined') {
    window.loadAdminUsuarios = loadAdminUsuarios;
}
