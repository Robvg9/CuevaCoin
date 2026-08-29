/** Fase 3 / Oleada 7 — Promo/felicitación chat privado */

export async function verificarPrimeraTransferenciaYFelicitar(usuarioId) {
    try {
        const { data: ultimaTx, error: errorUltima } = await window.supabaseClient
            .from('transacciones')
            .select('contraparte_id')
            .eq('usuario_id', usuarioId)
            .eq('tipo', 'transferencia')
            .order('creado_en', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (errorUltima || !ultimaTx || !ultimaTx.contraparte_id) return;

        const contraparteId = ultimaTx.contraparte_id;
        const { count, error: errorCount } = await window.supabaseClient
            .from('transacciones')
            .select('id', { count: 'exact', head: true })
            .eq('usuario_id', usuarioId)
            .eq('contraparte_id', contraparteId)
            .eq('tipo', 'transferencia');
        if (errorCount || count !== 1) return; // no es la primera vez, no molestar

        const { data: contraparte, error: errorPerfil } = await window.supabaseClient
            .from('perfiles')
            .select('nombre, usuario')
            .eq('id', contraparteId)
            .maybeSingle();
        if (errorPerfil || !contraparte) return;

        felicitacionPrivadoContraparteId = contraparteId;
        document.getElementById('felicitacion-privado-nombre').textContent = contraparte.nombre || contraparte.usuario;
        window.openModal('felicitacion-privado-modal');
    } catch (err) {
        console.error('Error verificando primera transferencia para felicitación:', err);
    }
}

export function irAProbarChatPrivadoDesdeFelicitacion() {
    const contraparteId = felicitacionPrivadoContraparteId;
    window.closeModal('felicitacion-privado-modal');
    window.loadSection('chat');
    window.cambiarTabChat('user', 'privado', contraparteId);
}

export async function actualizarBannerPromoChatPrivado(usuario) {
    const banner = document.getElementById('promo-chat-privado-banner');
    if (!banner || !usuario || usuario.esAdmin) {
        if (banner) banner.classList.add('hidden');
        return;
    }
    const { data: transferencias, error } = await window.supabaseClient
        .from('transacciones')
        .select('contraparte_id')
        .eq('usuario_id', usuario.id)
        .eq('tipo', 'transferencia')
        .not('contraparte_id', 'is', null)
        .limit(1);
    if (error) {
        console.error('Error revisando transferencias para el banner de chat privado:', error);
        banner.classList.add('hidden');
        return;
    }
    banner.classList.toggle('hidden', transferencias.length > 0);
}

if (typeof window !== 'undefined') {
    window.verificarPrimeraTransferenciaYFelicitar = verificarPrimeraTransferenciaYFelicitar;
    window.irAProbarChatPrivadoDesdeFelicitacion = irAProbarChatPrivadoDesdeFelicitacion;
    window.actualizarBannerPromoChatPrivado = actualizarBannerPromoChatPrivado;
}
