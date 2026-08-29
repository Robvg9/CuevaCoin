/**
 * CuevaCoin — js/data/supabase.js
 * Cliente Supabase + constantes de conexión (Fase 2 / Oleada 1).
 * Comportamiento 1:1 con el monolito original (v125).
 * No contiene lógica de negocio (retiros, transferencias, cola, chat, etc.).
 *
 * Requisito: el script CDN de @supabase/supabase-js debe haberse cargado
 * antes (window.supabase disponible).
 */

export const SUPABASE_URL = "https://zqgmjwfvluboiporytcq.supabase.co";
export const SUPABASE_KEY = "sb_publishable_fyqk_L78-Kv--pmzbIsqPw_iWFjVLug";

if (typeof window === 'undefined' || !window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[CuevaCoin] supabase-js no está disponible. Asegúrate de cargar el CDN antes de este módulo.');
}

export const supabaseClient = (typeof window !== 'undefined' && window.supabase)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

// ============================================
// F-GMAIL-POPUP — detección temprana en ventana emergente
// ============================================
// Si esta pestaña tiene window.opener, es el popup de Google OAuth.
// Se revisa error en URL/hash antes que la sesión, se guarda el error
// en localStorage para la ventana principal, y se cierra el popup
// cuando hay sesión (o error).
(function initGooglePopupEarlyClose() {
    if (typeof window === 'undefined') return;
    if (!(window.opener && window.opener !== window)) return;
    if (!supabaseClient) return;

    const paramsBusqueda = new URLSearchParams(window.location.search);
    const paramsHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const errorOAuth = paramsBusqueda.get('error_description') || paramsHash.get('error_description')
        || paramsBusqueda.get('error') || paramsHash.get('error');

    if (errorOAuth) {
        try {
            localStorage.setItem('cuevacoin_google_popup_error', errorOAuth);
        } catch (err) {
            console.error('No se pudo guardar el error de Google para la ventana principal:', err);
        }
        window.close();
        return;
    }

    const cerrarSiHaySesion = async () => {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            console.log('[popup-google] cerrarSiHaySesion: sesión encontrada =', !!session);
            if (session) window.close();
        } catch (err) {
            console.error('Popup de Google: error revisando sesión', err);
        }
    };

    supabaseClient.auth.onAuthStateChange((_event, session) => {
        console.log('[popup-google] onAuthStateChange:', _event, 'sesión =', !!session);
        if (session) window.close();
    });
    cerrarSiHaySesion();
    setTimeout(cerrarSiHaySesion, 600);
})();

// ============================================
// Compatibilidad con el monolito (scripts clásicos / referencias globales)
// ============================================
if (typeof window !== 'undefined') {
    window.SUPABASE_URL = SUPABASE_URL;
    window.SUPABASE_KEY = SUPABASE_KEY;
    window.supabaseClient = supabaseClient;
}
