/** Fase 3 / Oleada 4 — Buscar usuario transferir */

export function abrirBuscarUsuarioTransferir() {
    document.getElementById('buscar-usuario-transferir-input').value = '';
    document.getElementById('buscar-usuario-transferir-estado').textContent = '';
    window.openModal('buscar-usuario-transferir-modal');
    document.getElementById('buscar-usuario-transferir-input').focus();
}

export function cerrarBuscarUsuarioTransferir() {
    window.closeModal('buscar-usuario-transferir-modal');
}

if (typeof window !== 'undefined') {
    window.abrirBuscarUsuarioTransferir = abrirBuscarUsuarioTransferir;
    window.cerrarBuscarUsuarioTransferir = cerrarBuscarUsuarioTransferir;
}
