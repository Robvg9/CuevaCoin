/** Fase 3 / Oleada 4 — Buscar usuario transferir */

/**
 * Resuelve destinatario vía RPC segura (authenticated):
 * public.resolver_destinatario_transferencia(p_texto text)
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

    // Convención CuevaCoin: parámetros p_*
    let data;
    let error;
    ({ data, error } = await client.rpc('resolver_destinatario_transferencia', { p_texto: t }));

    // Compat: si el parámetro en SQL se llama distinto, reintentar nombres habituales
    if (error && /could not find the function|PGRST202|404/i.test(String(error.message || '') + String(error.code || ''))) {
        const alternates = [
            { texto: t },
            { p_busqueda: t },
            { busqueda: t },
            { p_query: t }
        ];
        for (const args of alternates) {
            const r = await client.rpc('resolver_destinatario_transferencia', args);
            if (!r.error) {
                data = r.data;
                error = null;
                break;
            }
            error = r.error;
        }
    }

    if (error) {
        console.error('resolver_destinatario_transferencia:', error);
        throw new Error(error.message || 'No se pudo buscar ese destinatario.');
    }

    const filas = Array.isArray(data) ? data.filter(Boolean) : (data ? [data] : []);
    if (filas.length === 0) {
        return null;
    }
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
