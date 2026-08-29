/**
 * CuevaCoin — js/auth/google-ui.js
 * Pantallas UI de verificación/registro Google (Oleada 3).
 */

export function entrarSegunVerificacionGoogle(usuario) {
    (window.ocultarCargando && window.ocultarCargando());
    if (!usuario.googleVinculado) {
        // DIAGNÓSTICO (2026-08-08): esta es la rama exacta del bug
        // reportado ("vuelve al mismo punto, no da un paso
        // adelante") - si window.__cuevacoinDiagGoogle quedó
        // cargado (viene de sincronizarVinculacionGoogleSiCorresponde,
        // llamada justo antes en procesarSesionYMostrarPantalla),
        // se muestra en pantalla con alert() para poder leerlo
        // directamente desde el celular, sin devtools. Mandar una
        // foto de este alert es lo que hace falta para diagnosticar
        // de una vez. Se puede borrar todo este bloque en cuanto se
        // resuelva el bug real.
        if (window.__cuevacoinDiagGoogle) {
            alert('DIAGNÓSTICO GOOGLE (mándale una foto de esto a soporte):\n\n' + JSON.stringify(window.__cuevacoinDiagGoogle, null, 2));
        }
        window.mostrarBloqueoVerificacionGoogle(usuario);
        return;
    }
    if (usuario.esAdmin) {
        window.showAdminPanel(usuario);
    } else {
        window.showUserDashboard(usuario);
    }
}

export function mostrarBloqueoVerificacionGoogle(usuario) {
    (window.ocultarSplashArranque && window.ocultarSplashArranque());
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('admin-panel').classList.add('hidden');
    document.getElementById('user-dashboard').classList.add('hidden');
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('app-topbar').classList.add('hidden');
    document.getElementById('google-vinculacion-screen').classList.remove('hidden');
}

// F-GMAIL-POPUP (v94): antes esto hacía linkIdentity() con redirect
// de página completa - mismo problema de fondo que iniciarSesionConGoogle
// (ver F-GMAIL-POPUP arriba de la creación de window.supabaseClient). Ahora

export function mostrarCompletarRegistroGoogle(correoGoogle) {
    (window.ocultarSplashArranque && window.ocultarSplashArranque());
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('admin-panel').classList.add('hidden');
    document.getElementById('user-dashboard').classList.add('hidden');
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('app-topbar').classList.add('hidden');
    document.getElementById('completar-registro-google-form').reset();
    document.getElementById('completar-registro-google-error').textContent = '';
    document.getElementById('completar-google-correo').textContent = correoGoogle || '';
    window.openModal('completar-registro-google-modal');
    (window.ocultarCargando && window.ocultarCargando());
}

export async function cancelarRegistroGoogle() {
    localStorage.removeItem('cuevacoin_google_flujo');
    window.closeModal('completar-registro-google-modal');
    try {
        await window.supabaseClient.functions.invoke('abandonar-cuenta-google-sin-perfil');
    } catch (err) {
        console.error('No se pudo autolimpiar la cuenta de Google abandonada:', err);
    }
    try {
        await window.supabaseClient.auth.signOut();
    } catch (err) {
        console.error('No se pudo cerrar la sesión al cancelar registro con Google:', err);
    }
    (window.showLoginScreen && window.showLoginScreen());
}

if (typeof window !== 'undefined') {
    window.entrarSegunVerificacionGoogle = entrarSegunVerificacionGoogle;
    window.mostrarBloqueoVerificacionGoogle = mostrarBloqueoVerificacionGoogle;
    window.mostrarCompletarRegistroGoogle = mostrarCompletarRegistroGoogle;
    window.cancelarRegistroGoogle = cancelarRegistroGoogle;
}
