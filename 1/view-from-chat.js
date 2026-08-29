/**
 * CuevaCoin — js/profile/view-from-chat.js
 * Ficha de perfil de otra trabajadora desde el chat (respeta privacidad).
 * Oleada 3. Sin saldo ni operaciones financieras.
 */

export async function verPerfilDesdeChat(usuarioId) {
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const campoVisible = (typeof window !== 'undefined' && window.campoVisiblePorPrivacidad)
        ? window.campoVisiblePorPrivacidad : () => true;
    const formatear = (typeof window !== 'undefined' && window.formatearUltimaVez)
        ? window.formatearUltimaVez : (v) => v || '';
    const open = (typeof window !== 'undefined' && window.openModal) ? window.openModal : () => {};

    if (!client) {
        toast('No se pudo cargar este perfil', 3000);
        return;
    }

    const { data: perfil, error } = await client
        .from('perfiles')
        .select('nombre, apellido, usuario, numero_cuenta, foto_url, numero_carnet, fecha_nacimiento, telefono, correo, ultima_conexion, preferencias_privacidad')
        .eq('id', usuarioId)
        .maybeSingle();
    if (error || !perfil) {
        console.error('Error cargando perfil para ver desde el chat:', error);
        toast('No se pudo cargar este perfil', 3000);
        return;
    }

    const fotoEl = document.getElementById('vp-foto');
    if (fotoEl) {
        if (perfil.foto_url) {
            fotoEl.src = perfil.foto_url;
            fotoEl.style.display = 'inline-block';
        } else {
            fotoEl.style.display = 'none';
        }
    }
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('vp-nombre', perfil.nombre || perfil.usuario);
    set('vp-usuario', perfil.usuario || '-');
    set('vp-numero-cuenta', perfil.numero_cuenta || '-');

    const camposOpcionales = [
        { campo: 'apellido', valor: perfil.apellido, filaId: 'vp-fila-apellido', spanId: 'vp-apellido' },
        { campo: 'numero_carnet', valor: perfil.numero_carnet, filaId: 'vp-fila-carnet', spanId: 'vp-carnet' },
        { campo: 'fecha_nacimiento', valor: perfil.fecha_nacimiento, filaId: 'vp-fila-fecha-nacimiento', spanId: 'vp-fecha-nacimiento' },
        { campo: 'telefono', valor: perfil.telefono, filaId: 'vp-fila-telefono', spanId: 'vp-telefono' },
        { campo: 'correo', valor: perfil.correo, filaId: 'vp-fila-correo', spanId: 'vp-correo' },
        { campo: 'ultima_conexion', valor: formatear(perfil.ultima_conexion), filaId: 'vp-fila-ultima-conexion', spanId: 'vp-ultima-conexion' }
    ];
    camposOpcionales.forEach(({ campo, valor, filaId, spanId }) => {
        const fila = document.getElementById(filaId);
        if (!fila) return;
        const visible = campoVisible(perfil, campo) && valor;
        fila.classList.toggle('hidden', !visible);
        if (visible) set(spanId, valor);
    });

    open('ver-perfil-modal');
}

if (typeof window !== 'undefined') {
    window.verPerfilDesdeChat = verPerfilDesdeChat;
}
