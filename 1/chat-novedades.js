/** Fase 3 / Oleada 7 — Novedades de contactos chat */

export async function obtenerResumenChatContactos(tipoChat, propioId, contactoIds) {
    const resumen = {};
    if (!contactoIds || contactoIds.length === 0) return resumen;
    const { data, error } = await window.supabaseClient
        .from('chat')
        .select('remitente_id, destinatario_id, creado_en')
        .eq('tipo', tipoChat)
        .or(`remitente_id.eq.${propioId},destinatario_id.eq.${propioId}`)
        .order('creado_en', { ascending: false })
        .limit(500);
    if (error) {
        console.error('Error trayendo resumen de chat por contacto:', error);
        return resumen;
    }
    const idsSet = new Set(contactoIds.map(String));
    data.forEach(msg => {
        const contraparteId = msg.remitente_id === propioId ? msg.destinatario_id : msg.remitente_id;
        if (!idsSet.has(String(contraparteId)) || resumen[contraparteId]) return;
        // data viene ordenada de más nuevo a más viejo: el primero
        // que aparece por contraparte ya es el último mensaje.
        resumen[contraparteId] = {
            ultimoMensajeEn: msg.creado_en,
            deContacto: msg.remitente_id === contraparteId,
        };
    });
    return resumen;
}

export function calcularContactosConNovedad(tipoVista, contactos, resumen) {
    const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    const tipoChat = tipoVista === 'admin' ? 'soporte' : 'privado';
    const visto = usuarioActual ? window.leerChatContactoVisto(usuarioActual.id, tipoChat) : {};
    const conNovedad = contactos.map(c => {
        const r = resumen[c.id];
        const ultimoMensajeEn = r ? r.ultimoMensajeEn : null;
        const ultimaVista = visto[c.id];
        const unread = !!(r && r.deContacto && (!ultimaVista || new Date(r.ultimoMensajeEn) > new Date(ultimaVista)));
        return Object.assign({}, c, { unread, ultimoMensajeEn });
    });
    // Array.prototype.sort es estable (ES2019+): los que empatan en
    // unread mantienen su orden relativo anterior (alfabético).
    conNovedad.sort((a, b) => {
        if (a.unread !== b.unread) return a.unread ? -1 : 1;
        if (a.unread && b.unread) return new Date(b.ultimoMensajeEn) - new Date(a.ultimoMensajeEn);
        return 0;
    });
    return conNovedad;
}

export async function revisarNovedadesChatInicial(rol, usuarioId) {
    const visto = window.leerChatVisto(usuarioId);

    async function revisarUno(tab, query) {
        const { data, error } = await query.order('creado_en', { ascending: false }).limit(1);
        if (error || !data || data.length === 0) return;
        const ultimo = data[0];
        if (ultimo.remitente_id === usuarioId) return;
        const ultimaVista = visto[tab];
        if (!ultimaVista || new Date(ultimo.creado_en) > new Date(ultimaVista)) {
            window.marcarChatTabConNovedad(rol, tab);
        }
    }

    await revisarUno('soporte', window.supabaseClient.from('chat').select('creado_en, remitente_id').eq('tipo', 'soporte').eq('destinatario_id', usuarioId));
    await revisarUno('grupal', window.supabaseClient.from('chat').select('creado_en, remitente_id').eq('tipo', 'grupal'));
    if (rol === 'user') {
        await revisarUno('privado', window.supabaseClient.from('chat').select('creado_en, remitente_id').eq('tipo', 'privado').eq('destinatario_id', usuarioId));
    }
}

if (typeof window !== 'undefined') {
    window.obtenerResumenChatContactos = obtenerResumenChatContactos;
    window.calcularContactosConNovedad = calcularContactosConNovedad;
    window.revisarNovedadesChatInicial = revisarNovedadesChatInicial;
}
