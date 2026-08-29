/**
 * CuevaCoin — js/ui/bonos-info.js
 * Contenido informativo de Bonos + puntos de novedad (Oleada 4).
 * No incluye edición admin ni lógica financiera.
 */

export function bonosInfoVistoStorageKey(usuarioId) {
    return `cuevacoin_bonos_info_visto_${usuarioId}`;
}

export async function loadUserBonosInfo() {
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    const el = document.getElementById('user-bonos-info-texto');
    if (!el) return;
    if (!client) {
        el.textContent = '';
        return;
    }
    const { data, error } = await client
        .from('contenido_bonos')
        .select('texto')
        .eq('id', 1)
        .single();
    if (error || !data) {
        console.error('Error cargando contenido_bonos:', error);
        el.textContent = '';
        return;
    }
    el.textContent = data.texto || '';
}

export async function verificarNovedadInfoBonos(usuarioId) {
    const dot = document.getElementById('bonos-info-dot');
    if (!dot) return;
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    if (!client) return;
    const { data, error } = await client
        .from('contenido_bonos')
        .select('actualizado_en')
        .eq('id', 1)
        .single();
    if (error || !data) return;
    const ultimaVista = localStorage.getItem(bonosInfoVistoStorageKey(usuarioId));
    const hayNovedad = !ultimaVista || new Date(data.actualizado_en) > new Date(ultimaVista);
    dot.classList.toggle('hidden', !hayNovedad);
}

export async function marcarInfoBonosVista(usuarioId) {
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    if (!client) return;
    const { data, error } = await client
        .from('contenido_bonos')
        .select('actualizado_en')
        .eq('id', 1)
        .single();
    if (error || !data) return;
    localStorage.setItem(bonosInfoVistoStorageKey(usuarioId), data.actualizado_en);
    const dot = document.getElementById('bonos-info-dot');
    if (dot) dot.classList.add('hidden');
}

export async function actualizarBonosDot(esAdmin) {
    const dot = document.getElementById('bonos-dot');
    if (!dot) return;
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    if (!client) return;
    if (esAdmin) {
        const { count, error } = await client
            .from('sugerencias')
            .select('id', { count: 'exact', head: true })
            .eq('leida', false);
        if (error) { console.error(error); return; }
        dot.classList.toggle('hidden', !(count > 0));
    } else {
        const usuarioActual = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
        if (!usuarioActual) return;
        const { count, error } = await client
            .from('sugerencias')
            .select('id', { count: 'exact', head: true })
            .eq('usuario_id', usuarioActual.id)
            .eq('respuesta_vista', false)
            .not('respuesta', 'is', null);
        if (error) { console.error(error); return; }
        dot.classList.toggle('hidden', !(count > 0));
    }
}

if (typeof window !== 'undefined') {
    window.bonosInfoVistoStorageKey = bonosInfoVistoStorageKey;
    window.loadUserBonosInfo = loadUserBonosInfo;
    window.verificarNovedadInfoBonos = verificarNovedadInfoBonos;
    window.marcarInfoBonosVista = marcarInfoBonosVista;
    window.actualizarBonosDot = actualizarBonosDot;
}
