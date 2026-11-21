/** Fase 3 / Oleada 4 — Buscar destinatario privado por ID */

export async function resolverDestinatarioTransferencia(texto) {
    const t = (texto || '').trim();
    if (!t) throw new Error('Escribe un correo, usuario o nombre.');
    const client = window.supabaseClient;
    if (!client || typeof client.rpc !== 'function') throw new Error('Cliente de conexión no listo. Recarga la app.');

    const { data, error } = await client.rpc('resolver_destinatario_transferencia_v2', {
        p_identificador: t
    });
    if (error) {
        console.error('resolver_destinatario_transferencia_v2:', error);
        throw new Error(error.message || 'No se pudo buscar ese destinatario.');
    }
    const filas = Array.isArray(data) ? data.filter(Boolean) : (data ? [data] : []);
    if (filas.length === 0) return null;
    if (filas.length > 1) throw new Error('Hay varias cuentas con ese dato. Usa el usuario exacto.');
    const fila = filas[0];
    if (!fila.id) throw new Error('La cuenta encontrada no devolvió un identificador válido.');
    return {
        id: fila.id,
        usuario: fila.usuario || '',
        nombre: fila.nombre || '',
        apellido: fila.apellido || '',
        estado: fila.estado || null
    };
}

/** Mantiene el ID interno en memoria y muestra únicamente el nombre/usuario. */
export function establecerDestinatarioTransferencia(destinatario, viaQR = false) {
    if (!destinatario || !destinatario.id) throw new Error('Destinatario no válido.');
    const nombre = [destinatario.nombre, destinatario.apellido].filter(Boolean).join(' ').trim();
    const usuario = String(destinatario.usuario || '').trim();
    const visible = nombre || (usuario ? '@' + usuario : 'Destinatario seleccionado');
    const input = document.getElementById('transferir-destinatario-correo');
    if (!input) throw new Error('No se encontró el campo de destinatario.');
    window.transferenciaDestinatarioSeleccionado = {
        id: destinatario.id, nombre, apellido: destinatario.apellido || '',
        usuario, estado: destinatario.estado || null
    };
    input.value = visible;
    window.transferenciaViaQR = Boolean(viaQR);
    return window.transferenciaDestinatarioSeleccionado;
}

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
    window.resolverDestinatarioTransferencia = resolverDestinatarioTransferencia;
    window.establecerDestinatarioTransferencia = establecerDestinatarioTransferencia;
    window.abrirBuscarUsuarioTransferir = abrirBuscarUsuarioTransferir;
    window.cerrarBuscarUsuarioTransferir = cerrarBuscarUsuarioTransferir;
}
