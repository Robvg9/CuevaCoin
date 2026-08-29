/**
 * CuevaCoin — js/admin/bonos-contenido.js
 * Texto informativo de la sección Bonos (admin) — Oleada 6.
 * Solo contenido editorial; no mueve dinero.
 */

export async function loadContenidoBonosAdminForm() {
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    if (!client) return;
    const { data, error } = await client
        .from('contenido_bonos')
        .select('texto')
        .eq('id', 1)
        .single();
    if (error || !data) {
        console.error('Error cargando contenido_bonos:', error);
        return;
    }
    const el = document.getElementById('contenido-bonos-texto');
    if (el) el.value = data.texto || '';
}

export async function guardarContenidoBonosAdmin() {
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    if (!client) {
        toast('No se pudo guardar', 3000);
        return;
    }
    const texto = (document.getElementById('contenido-bonos-texto') || {}).value;
    const textoTrim = (texto || '').trim();
    if (!textoTrim) {
        toast('Escribe algo antes de guardar', 3000);
        return;
    }
    const { error } = await client
        .from('contenido_bonos')
        .update({ texto: textoTrim, actualizado_en: new Date().toISOString() })
        .eq('id', 1);
    if (error) {
        console.error('Error guardando contenido_bonos:', error);
        toast('No se pudo guardar', 3000);
        return;
    }
    toast('Guardado - las trabajadoras verán una burbuja de aviso', 3000);
}

export function setupContenidoBonosForm() {
    const form = document.getElementById('contenido-bonos-form');
    if (!form || form.dataset.cuevacoinBound) return;
    form.dataset.cuevacoinBound = '1';
    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        await guardarContenidoBonosAdmin();
    });
}

if (typeof window !== 'undefined') {
    window.loadContenidoBonosAdminForm = loadContenidoBonosAdminForm;
    window.guardarContenidoBonosAdmin = guardarContenidoBonosAdmin;
    window.setupContenidoBonosForm = setupContenidoBonosForm;
}
