/** CuevaCoin — js/admin/ver-usuario-modal.js
 * Fase 5 — Modal ver usuario desde chat admin (solo lectura UI).
 */

export async function abrirVerUsuarioModal() {
    const destinatarioSelect = document.getElementById('admin-chat-destinatario');
    const usuarioId = destinatarioSelect.value;
    if (!usuarioId) {
        alert('Selecciona primero un usuario en el chat.');
        return;
    }
    const trabajadoras = await obtenerTrabajadoras();
    const u = trabajadoras.find(t => t.id === usuarioId);
    if (!u) {
        alert('No se encontró la información de este usuario.');
        return;
    }
    const fotoEl = document.getElementById('vu-foto');
    if (u.foto) {
        fotoEl.src = u.foto;
        fotoEl.style.display = 'inline-block';
    } else {
        fotoEl.style.display = 'none';
    }
    document.getElementById('vu-nombre').textContent = u.nombre || '-';
    document.getElementById('vu-apellido').textContent = u.apellido || '-';
    document.getElementById('vu-usuario').textContent = u.usuario || '-';
    document.getElementById('vu-carnet').textContent = u.numeroCarnet || '-';
    document.getElementById('vu-fecha-nacimiento').textContent = u.fechaNacimiento || '-';
    document.getElementById('vu-correo').textContent = u.correo || '-';
    document.getElementById('vu-telefono').textContent = u.telefono || '-';
    document.getElementById('vu-numero-cuenta').textContent = u.numeroCuenta || '-';
    document.getElementById('vu-saldo').textContent = `$${Number(u.saldo).toFixed(2)}`;
    document.getElementById('vu-estado').textContent = u.estado || '-';
    window.openModal('ver-usuario-modal');
}

if (typeof window !== 'undefined') {
    window.abrirVerUsuarioModal = abrirVerUsuarioModal;
}
