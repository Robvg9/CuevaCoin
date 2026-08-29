/**
 * CuevaCoin — js/ui/anuncios.js
 * Cartel de anuncio global para la trabajadora (Oleada 4).
 * Solo lectura + cierre local de sesión; no admin financiero.
 */

export async function verificarAnuncioActivo() {
    if (sessionStorage.getItem('cuevacoin_anuncio_visto_sesion')) return;
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    if (!client) return;
    const { data, error } = await client
        .from('anuncio_app')
        .select('mensaje, duracion_horas, creado_en')
        .eq('id', 1)
        .single();
    if (error || !data || !data.mensaje || !data.mensaje.trim()) return;
    if (data.duracion_horas != null) {
        const vence = new Date(new Date(data.creado_en).getTime() + data.duracion_horas * 3600000);
        if (vence <= new Date()) return;
    }
    const el = document.getElementById('cartel-anuncio-texto');
    if (el) el.textContent = data.mensaje;
    if (typeof window !== 'undefined' && window.openModal) {
        window.openModal('cartel-anuncio-modal');
    }
}

export function cerrarCartelAnuncio() {
    if (typeof window !== 'undefined' && window.closeModal) {
        window.closeModal('cartel-anuncio-modal');
    }
    sessionStorage.setItem('cuevacoin_anuncio_visto_sesion', '1');
}

if (typeof window !== 'undefined') {
    window.verificarAnuncioActivo = verificarAnuncioActivo;
    window.cerrarCartelAnuncio = cerrarCartelAnuncio;
}
