/**
 * CuevaCoin — js/admin/anuncios-admin.js
 * Gestión del cartel de anuncio (admin) — Oleada 5.
 * Contenido informativo; no toca saldo/retiros/transferencias/cola.
 */

export function abrirModalAnuncio() {
    // Punto 3 (2026-08-08): lleva a la sección real de Anuncios.
    if (typeof window !== 'undefined' && typeof window.loadSection === 'function') {
        window.loadSection('anuncios');
    }
}

export async function loadAnuncioAdminForm() {
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    const estadoEl = document.getElementById('anuncio-app-estado');
    const btnQuitar = document.getElementById('anuncio-app-btn-quitar');
    if (!client) {
        if (estadoEl) estadoEl.textContent = '';
        if (btnQuitar) btnQuitar.disabled = true;
        return;
    }
    const { data, error } = await client
        .from('anuncio_app')
        .select('mensaje, duracion_horas, creado_en')
        .eq('id', 1)
        .single();
    if (error || !data) {
        console.error('Error cargando anuncio_app:', error);
        if (estadoEl) estadoEl.textContent = '';
        if (btnQuitar) btnQuitar.disabled = true;
        return;
    }
    const msgEl = document.getElementById('anuncio-app-mensaje');
    const durEl = document.getElementById('anuncio-app-duracion');
    if (msgEl) msgEl.value = data.mensaje || '';
    if (durEl) durEl.value = data.duracion_horas != null ? String(data.duracion_horas) : '';
    const hayMensaje = !!(data.mensaje && data.mensaje.trim());
    if (btnQuitar) btnQuitar.disabled = !hayMensaje;
    if (estadoEl) {
        if (hayMensaje) {
            if (data.duracion_horas == null) {
                estadoEl.textContent = 'Cartel activo, sin vencimiento (hasta que lo quites manualmente).';
            } else {
                const vence = new Date(new Date(data.creado_en).getTime() + data.duracion_horas * 3600000);
                const vigente = vence > new Date();
                estadoEl.textContent = vigente
                    ? `Cartel activo, visible hasta el ${vence.toLocaleString('es-PR')}.`
                    : `El último anuncio ya venció (${vence.toLocaleString('es-PR')}). Guarda de nuevo para reactivarlo con la duración de arriba.`;
            }
        } else {
            estadoEl.textContent = 'Sin cartel activo ahora mismo.';
        }
    }
}

export async function quitarAnuncioApp() {
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    if (!confirm('¿Quitar el cartel de anuncio? Dejará de mostrarse a todas apenas guardes este cambio.')) return;
    if (!client) {
        toast('No se pudo quitar el anuncio', 3000);
        return;
    }
    const { error } = await client
        .from('anuncio_app')
        .update({ mensaje: null, duracion_horas: null, creado_en: new Date().toISOString() })
        .eq('id', 1);
    if (error) {
        console.error('Error quitando anuncio_app:', error);
        toast('No se pudo quitar el anuncio', 3000);
        return;
    }
    sessionStorage.removeItem('cuevacoin_anuncio_visto_sesion');
    toast('Anuncio quitado correctamente', 3000);
    await loadAnuncioAdminForm();
}

export async function guardarAnuncioApp() {
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    if (!client) {
        toast('No se pudo guardar el anuncio', 3000);
        return;
    }
    const mensaje = (document.getElementById('anuncio-app-mensaje') || {}).value;
    const mensajeTrim = (mensaje || '').trim();
    const duracionRaw = (document.getElementById('anuncio-app-duracion') || {}).value;
    const duracionHoras = duracionRaw === '' || duracionRaw == null ? null : parseInt(duracionRaw, 10);
    const { error } = await client
        .from('anuncio_app')
        .update({
            mensaje: mensajeTrim || null,
            duracion_horas: duracionHoras,
            creado_en: new Date().toISOString()
        })
        .eq('id', 1);
    if (error) {
        console.error('Error guardando anuncio_app:', error);
        toast('No se pudo guardar el anuncio', 3000);
        return;
    }
    sessionStorage.removeItem('cuevacoin_anuncio_visto_sesion');
    toast(mensajeTrim ? 'Anuncio guardado, ya está vigente' : 'Cartel desactivado (mensaje vacío)', 3000);
    await loadAnuncioAdminForm();
}

export function setupAnuncioAdminForm() {
    const form = document.getElementById('anuncio-app-form');
    if (!form || form.dataset.cuevacoinBound) return;
    form.dataset.cuevacoinBound = '1';
    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        await guardarAnuncioApp();
    });
}

if (typeof window !== 'undefined') {
    window.abrirModalAnuncio = abrirModalAnuncio;
    window.loadAnuncioAdminForm = loadAnuncioAdminForm;
    window.quitarAnuncioApp = quitarAnuncioApp;
    window.guardarAnuncioApp = guardarAnuncioApp;
    window.setupAnuncioAdminForm = setupAnuncioAdminForm;
}
