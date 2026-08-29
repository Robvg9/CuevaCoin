/**
 * CuevaCoin — js/profile/password.js
 * Cambio de contraseña (cuenta) — Oleada 5.
 * Auth de usuario; no toca saldo/retiros/transferencias/cola.
 */

export async function enviarCambioContrasena() {
    const requiere = (typeof window !== 'undefined' && window.requiereConexionParaOperar)
        ? window.requiereConexionParaOperar : () => true;
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    const usuarioAEmail = (typeof window !== 'undefined' && window.usuarioAEmail)
        ? window.usuarioAEmail : (u) => u;

    if (!requiere()) return;
    if (!client) {
        toast('No se pudo cambiar la contraseña', 3000);
        return;
    }

    const contrasenaActual = document.getElementById('contrasena-actual').value;
    const nuevaContrasena = document.getElementById('nueva-contrasena').value;
    const confirmarContrasena = document.getElementById('confirmar-contrasena').value;
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    if (!usuario) return;

    if (nuevaContrasena !== confirmarContrasena) {
        toast('Las contraseñas no coinciden', 3000);
        return;
    }

    const { error: authError } = await client.auth.signInWithPassword({
        email: usuarioAEmail(usuario.usuario),
        password: contrasenaActual
    });
    if (authError) {
        toast('Contraseña actual incorrecta', 3000);
        return;
    }

    const { error } = await client.auth.updateUser({ password: nuevaContrasena });
    if (error) {
        console.error(error);
        toast('No se pudo cambiar la contraseña', 3000);
        return;
    }

    toast('Contraseña cambiada correctamente', 3000);
    document.getElementById('contrasena-actual').value = '';
    document.getElementById('nueva-contrasena').value = '';
    document.getElementById('confirmar-contrasena').value = '';
}

/**
 * Engancha el submit de #cambiar-contrasena-form (idempotente).
 */
export function setupCambiarContrasenaForm() {
    const form = document.getElementById('cambiar-contrasena-form');
    if (!form || form.dataset.cuevacoinBound) return;
    form.dataset.cuevacoinBound = '1';
    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        await enviarCambioContrasena();
    });
}

if (typeof window !== 'undefined') {
    window.enviarCambioContrasena = enviarCambioContrasena;
    window.setupCambiarContrasenaForm = setupCambiarContrasenaForm;
}
