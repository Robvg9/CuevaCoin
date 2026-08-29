/**
 * CuevaCoin — js/data/profiles.js
 * Perfil propio, mapeo perfiles ↔ usuarioApp, privacidad básica (Fase 2 / Oleada 1).
 * Comportamiento 1:1 con el monolito original (v125).
 * No contiene lógica de retiros, transferencias, cola ni saldo.
 *
 * Depende de:
 *   - supabaseClient (js/data/supabase.js)
 *   - calcularPerfilCompleto, showToast (js/core/utils.js)
 *   - actualizarBannerPromoChatPrivado (sigue en el monolito por ahora)
 */

// ============================================
// MAPEO fila perfiles → objeto que usa la app
// ============================================
export function perfilAUsuarioApp(perfil) {
    const usuarioApp = {
        id: perfil.id,
        nombre: perfil.nombre,
        usuario: perfil.usuario,
        esAdmin: perfil.es_admin,
        saldo: perfil.saldo,
        numeroCuenta: perfil.numero_cuenta,
        foto: perfil.foto_url,
        estado: perfil.estado,
        ultimaConexion: perfil.ultima_conexion,
        apellido: perfil.apellido,
        numeroCarnet: perfil.numero_carnet,
        fechaNacimiento: perfil.fecha_nacimiento,
        correo: perfil.correo,
        telefono: perfil.telefono,
        frasePersonal: perfil.frase_personal,
        colorAcento: perfil.color_acento || 'rosa',
        metaAhorro: perfil.meta_ahorro,
        preferenciasPrivacidad: perfil.preferencias_privacidad,
        googleVinculado: perfil.google_vinculado,
        googleEmail: perfil.google_email
    };
    const calcular = (typeof window !== 'undefined' && window.calcularPerfilCompleto)
        ? window.calcularPerfilCompleto
        : null;
    usuarioApp.perfilCompleto = calcular ? calcular(usuarioApp) : false;
    return usuarioApp;
}

// ============================================
// PRIVACIDAD DE CAMPOS (punto 41c)
// ============================================
export const CAMPOS_PRIVACIDAD = ['apellido', 'numero_carnet', 'fecha_nacimiento', 'telefono', 'correo', 'ultima_conexion'];

export function campoVisiblePorPrivacidad(perfilFila, campo) {
    const prefs = perfilFila?.preferencias_privacidad || {};
    return prefs[campo] !== false;
}

// ============================================
// PERFIL PROPIO (sesión actual)
// ============================================
export async function obtenerMiPerfilApp() {
    const client = (typeof window !== 'undefined' && window.supabaseClient) ? window.supabaseClient : null;
    if (!client) throw new Error('supabaseClient no disponible');

    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;
    const { data, error } = await client
        .from('perfiles')
        .select('*')
        .eq('id', user.id)
        .single();
    if (error) throw error;
    const usuarioApp = perfilAUsuarioApp(data);
    try {
        localStorage.setItem('cuevacoin_perfil_cache', JSON.stringify(usuarioApp));
    } catch (err) {
        console.error('No se pudo cachear el perfil para modo offline:', err);
    }
    return usuarioApp;
}

// ============================================
// F-GMAIL: sincronizar vinculación Google → perfiles
// ============================================
export async function sincronizarVinculacionGoogleSiCorresponde(usuarioApp) {
    if (usuarioApp.googleVinculado) return usuarioApp;

    const client = (typeof window !== 'undefined' && window.supabaseClient) ? window.supabaseClient : null;
    const showToastFn = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const calcular = (typeof window !== 'undefined' && window.calcularPerfilCompleto) ? window.calcularPerfilCompleto : null;

    window.__cuevacoinDiagGoogle = { paso: 'empezó sincronizarVinculacionGoogleSiCorresponde' };
    try {
        if (!client) return usuarioApp;
        const { data: { user } } = await client.auth.getUser();
        const identidadGoogle = user?.identities?.find(i => i.provider === 'google');
        window.__cuevacoinDiagGoogle.identidadGoogleEncontrada = !!identidadGoogle;
        window.__cuevacoinDiagGoogle.totalIdentidades = user?.identities?.length ?? 'sin user';
        if (!identidadGoogle) return usuarioApp;

        const correoGoogle = identidadGoogle.identity_data?.email || user.email;
        window.__cuevacoinDiagGoogle.correoGoogle = correoGoogle;

        const { error } = await client
            .from('perfiles')
            .update({ google_vinculado: true, google_email: correoGoogle, correo: correoGoogle })
            .eq('id', usuarioApp.id);
        if (error) throw error;
        window.__cuevacoinDiagGoogle.updateOk = true;

        usuarioApp.googleVinculado = true;
        usuarioApp.googleEmail = correoGoogle;
        usuarioApp.correo = correoGoogle;
        if (calcular) usuarioApp.perfilCompleto = calcular(usuarioApp);
        try {
            localStorage.setItem('cuevacoin_perfil_cache', JSON.stringify(usuarioApp));
        } catch (err) {
            console.error('No se pudo actualizar el perfil cacheado tras vincular Google:', err);
        }
        showToastFn('¡Cuenta vinculada con Google!', 3000);
    } catch (err) {
        console.error('No se pudo sincronizar la vinculación con Google:', err);
        window.__cuevacoinDiagGoogle.error = String(err?.message || err);
    }
    return usuarioApp;
}

// ============================================
// UI: badge perfil incompleto + habilitar Transferir/Retiro
// ============================================
// Nota: llama a actualizarBannerPromoChatPrivado (aún en el monolito).
export function actualizarEstadoPerfil(usuario) {
    if (!usuario || usuario.esAdmin) return;

    const banner = document.getElementById('perfil-incompleto-banner');
    const badge = document.getElementById('perfil-incompleto-badge');
    const btnTransferir = document.getElementById('btn-transferir');
    const btnRetiro = document.getElementById('btn-retiro');

    const incompleto = !usuario.perfilCompleto;
    if (banner) banner.classList.toggle('hidden', !incompleto);
    if (badge) badge.classList.toggle('hidden', !incompleto);
    [btnTransferir, btnRetiro].forEach(btn => {
        if (!btn) return;
        btn.disabled = incompleto;
        btn.classList.toggle('btn-deshabilitado', incompleto);
        btn.title = incompleto ? 'Completa tu perfil para poder usar esta función' : '';
    });

    if (typeof window !== 'undefined' && typeof window.actualizarBannerPromoChatPrivado === 'function') {
        window.actualizarBannerPromoChatPrivado(usuario);
    }
}

// ============================================
// Compatibilidad con el monolito
// ============================================
if (typeof window !== 'undefined') {
    window.perfilAUsuarioApp = perfilAUsuarioApp;
    window.CAMPOS_PRIVACIDAD = CAMPOS_PRIVACIDAD;
    window.campoVisiblePorPrivacidad = campoVisiblePorPrivacidad;
    window.obtenerMiPerfilApp = obtenerMiPerfilApp;
    window.sincronizarVinculacionGoogleSiCorresponde = sincronizarVinculacionGoogleSiCorresponde;
    window.actualizarEstadoPerfil = actualizarEstadoPerfil;
}
