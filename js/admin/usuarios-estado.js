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
    if (!admin?.esAdmin || !client) {
        toast('Solo el administrador puede cambiar el estado de los usuarios', 3000);
        return;
    }

    const { data: perfil, error: errorLectura } = await client
        .from('perfiles')
        .select('nombre, usuario, estado, es_admin')
        .eq('id', usuarioId)
        .single();
    if (errorLectura || !perfil) {
        console.error(errorLectura);
        toast('No se pudo leer el usuario', 3000);
        return;
    }

    if (perfil.es_admin) {
        toast('No puedes modificar el estado de una cuenta administradora.', 3500);
        return;
    }
    if (perfil.estado === 'archivado') {
        toast('Este usuario está archivado. Restáuralo antes de activar o desactivar.', 4000);
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

/**
 * Archiva a un trabajador sin borrar su perfil ni sus relaciones financieras.
 * Los flujos financieros server-side ya exigen estado='activo'.
 * Restaurar nunca reactiva el acceso automáticamente: queda inactivo.
 */
export async function archivarUsuario(usuarioId) {
    const requiere = typeof window.requiereConexionParaOperar === 'function' ? window.requiereConexionParaOperar : () => false;
    const toast = typeof window.showToast === 'function' ? window.showToast : () => {};
    const client = window.supabaseClient;
    const admin = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    if (!requiere()) return;
    if (!admin?.esAdmin || !client) { toast('Solo el administrador puede archivar usuarios', 3000); return; }

    const { data: perfil, error: readError } = await client.from('perfiles')
        .select('nombre, usuario, estado, es_admin').eq('id', usuarioId).single();
    if (readError || !perfil) { console.error(readError); toast('No se pudo leer el usuario', 3000); return; }
    if (perfil.es_admin) { toast('No se puede archivar una cuenta administradora', 3500); return; }
    if (perfil.estado === 'archivado') { toast('Este usuario ya está archivado', 3000); return; }

    const nombre = perfil.nombre || perfil.usuario || 'usuario';
    const confirmar = '¿Archivar a ' + nombre + '? No podrá iniciar sesión ni operar. Se conservarán saldo, transacciones, retiros, chat y auditoría.';
    if (!confirm(confirmar)) return;
    const { data: actualizado, error } = await client.from('perfiles')
        .update({ estado: 'archivado' }).eq('id', usuarioId).eq('es_admin', false)
        .neq('estado', 'archivado').select('id').maybeSingle();
    if (error || !actualizado) { console.error(error); toast('No se pudo archivar el usuario', 3500); return; }

    const { error: auditError } = await client.from('auditoria').insert({
        usuario_id: admin.id, usuario_nombre: admin.nombre || admin.usuario,
        accion: 'Archivó al usuario ' + nombre + ' (estado previo: ' + (perfil.estado || 'desconocido') + '). Historial conservado.'
    });
    if (auditError) console.error('No se pudo registrar la auditoría del archivado:', auditError);
    toast('Usuario archivado. Su historial se conserva.', 3500);
    if (typeof window.loadAdminUsuarios === 'function') window.loadAdminUsuarios();
    if (typeof window.loadAdminStats === 'function') window.loadAdminStats();
    if (typeof window.loadChatDestinatarios === 'function') window.loadChatDestinatarios();
}

export async function restaurarUsuario(usuarioId) {
    const requiere = typeof window.requiereConexionParaOperar === 'function' ? window.requiereConexionParaOperar : () => false;
    const toast = typeof window.showToast === 'function' ? window.showToast : () => {};
    const client = window.supabaseClient;
    const admin = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    if (!requiere()) return;
    if (!admin?.esAdmin || !client) { toast('Solo el administrador puede restaurar usuarios', 3000); return; }

    const { data: perfil, error: readError } = await client.from('perfiles')
        .select('nombre, usuario, estado, es_admin').eq('id', usuarioId).single();
    if (readError || !perfil) { console.error(readError); toast('No se pudo leer el usuario', 3000); return; }
    if (perfil.es_admin || perfil.estado !== 'archivado') {
        toast('El usuario no está archivado o la cuenta no se puede restaurar desde aquí', 3500); return;
    }
    const nombre = perfil.nombre || perfil.usuario || 'usuario';
    if (!confirm('¿Restaurar a ' + nombre + '? Quedará inactivo hasta que pulses “Activar”; no recuperará acceso automáticamente.')) return;
    const { data: actualizado, error } = await client.from('perfiles')
        .update({ estado: 'inactivo' }).eq('id', usuarioId).eq('es_admin', false)
        .eq('estado', 'archivado').select('id').maybeSingle();
    if (error || !actualizado) { console.error(error); toast('No se pudo restaurar el usuario', 3500); return; }

    const { error: auditError } = await client.from('auditoria').insert({
        usuario_id: admin.id, usuario_nombre: admin.nombre || admin.usuario,
        accion: 'Restauró al usuario ' + nombre + '; quedó inactivo hasta activación manual.'
    });
    if (auditError) console.error('No se pudo registrar la auditoría de restauración:', auditError);
    toast('Usuario restaurado como inactivo. Actívalo aparte si corresponde.', 4000);
    if (typeof window.loadAdminUsuarios === 'function') window.loadAdminUsuarios();
    if (typeof window.loadAdminStats === 'function') window.loadAdminStats();
    if (typeof window.loadChatDestinatarios === 'function') window.loadChatDestinatarios();
}

if (typeof window !== 'undefined') {
    window.eliminarUsuario = eliminarUsuario;
    window.archivarUsuario = archivarUsuario;
    window.restaurarUsuario = restaurarUsuario;
}
