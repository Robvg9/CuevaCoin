/**
 * CuevaCoin — js/admin/trabajadoras.js
 * Lectura de trabajadoras + debounce de filtro UI — Oleada 6.
 * Solo lista/mapeo; no modifica saldo ni aprueba retiros.
 */

export async function obtenerTrabajadoras() {
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    const map = (typeof window !== 'undefined' && window.perfilAUsuarioApp)
        ? window.perfilAUsuarioApp : (p) => p;
    if (!client) return [];
    const { data, error } = await client
        .from('perfiles')
        .select('*')
        .eq('es_admin', false)
        .order('nombre');
    if (error) {
        console.error(error);
        return [];
    }
    return data.map(map);
}

export function debounceFiltroUsuariosAdmin() {
    if (typeof window === 'undefined') return;
    clearTimeout(window.debounceFiltroUsuariosAdminId);
    window.debounceFiltroUsuariosAdminId = setTimeout(() => {
        if (typeof window.loadAdminUsuarios === 'function') {
            window.loadAdminUsuarios();
        }
    }, 350);
}

if (typeof window !== 'undefined') {
    window.obtenerTrabajadoras = obtenerTrabajadoras;
    window.debounceFiltroUsuariosAdmin = debounceFiltroUsuariosAdmin;
}
