/**
 * CuevaCoin — js/admin/usuarios-estado.js
 * Toggle activar/desactivar trabajadora (eliminarUsuario) — Oleada 7.
 * No borra cuentas ni mueve saldo; solo cambia perfiles.estado.
 */

export async function eliminarUsuario(usuarioId) {
    const requiere = (typeof window !== 'undefined' && window.requiereConexionParaOperar)
        ? window.requiereConexionParaOperar : () => true;
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;

    if (!requiere()) return;
    const admin = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    if (!admin || !client) return;

    const { data: perfil, error: errorLectura } = await client
        .from('perfiles')
        .select('nombre, usuario, estado')
        .eq('id', usuarioId)
        .single();
    if (errorLectura || !perfil) {
        console.error(errorLectura);
        toast('No se pudo leer el usuario', 3000);
        return;
    }

    const estaActivo = perfil.estado === 'activo';
    const nuevoEstado = estaActivo ? 'inactivo' : 'activo';
    const mensajeConfirmacion = estaActivo
        ? '¿Estás seguro de desactivar este usuario? Su historial se conserva; solo deja de poder iniciar sesión y de aparecer como activo.'
        : '¿Estás seguro de volver a activar este usuario? Podrá iniciar sesión y operar normalmente de nuevo.';
    if (!confirm(mensajeConfirmacion)) {
        return;
    }

    const { error: errorUpdate } = await client
        .from('perfiles')
        .update({ estado: nuevoEstado })
        .eq('id', usuarioId);
    if (errorUpdate) {
        console.error(errorUpdate);
        toast(estaActivo ? 'No se pudo desactivar el usuario' : 'No se pudo activar el usuario', 3000);
        return;
    }

    const { error: errorAuditoria } = await client
        .from('auditoria')
        .insert({
            usuario_id: admin.id,
            usuario_nombre: admin.nombre || admin.usuario,
            accion: `${estaActivo ? 'Desactivó' : 'Activó'} al usuario ${perfil.nombre || perfil.usuario}`
        });
    if (errorAuditoria) console.error(errorAuditoria);

    toast(estaActivo ? 'Usuario desactivado correctamente' : 'Usuario activado correctamente', 3000);
    if (typeof window.loadAdminUsuarios === 'function') window.loadAdminUsuarios();
    if (typeof window.loadAdminStats === 'function') window.loadAdminStats();
    if (typeof window.loadChatDestinatarios === 'function') window.loadChatDestinatarios();
}

if (typeof window !== 'undefined') {
    window.eliminarUsuario = eliminarUsuario;
}
