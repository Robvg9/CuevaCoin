/** Fase 3 / Oleada 4 — Buscar usuario transferir */

/**
 * Resuelve destinatario vía RPC segura (authenticated):
 * public.resolver_destinatario_transferencia(p_identificador text)
 * Acepta correo, nombre de usuario o nombre mostrado (case-insensitive).
 *
 * @returns {Promise<{id:string, usuario:string, nombre:string, correo:string}|null>}
 *          null si no hay coincidencia; lanza Error con mensaje de UX si ambigüedad u otro fallo.
 */
export async function resolverDestinatarioTransferencia(texto) {
    const t = (texto || '').trim();
    if (!t) throw new Error('Escribe un correo, usuario o nombre.');

    const client = window.supabaseClient;
    if (!client || typeof client.rpc !== 'function') {
        throw new Error('Cliente de conexión no listo. Recarga la app.');
    }

    // Contrato real de Supabase: p_identificador.
    const { data, error } = await client.rpc('resolver_destinatario_transferencia', {
        p_identificador: t
    });

    if (error) {
        console.error('resolver_destinatario_transferencia:', error);
        throw new Error(error.message || 'No se pudo buscar ese destinatario.');
    }

    const filas = Array.isArray(data) ? data.filter(Boolean) : (data ? [data] : []);
    if (filas.length === 0) return null;

    if (filas.length > 1) {
        throw new Error('Hay varias cuentas con ese dato. Usa el correo electrónico exacto.');
    }

    const fila = filas[0];
    const correo = fila.correo || fila.email || null;
    if (!correo) {
        throw new Error('La cuenta encontrada no tiene correo válido.');
    }

    return {
        id: fila.id,
        usuario: fila.usuario || '',
        nombre: fila.nombre || '',
        correo: correo,
        estado: fila.estado || null
    };
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
    window.abrirBuscarUsuarioTransferir = abrirBuscarUsuarioTransferir;
    window.cerrarBuscarUsuarioTransferir = cerrarBuscarUsuarioTransferir;
}
