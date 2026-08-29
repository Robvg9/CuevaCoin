/** Fase 3 / Oleada 3 — Meta de ahorro */

export function actualizarMetaAhorroInicio(usuario) {
    const card = document.getElementById('meta-ahorro-card');
    const sinFijar = document.getElementById('meta-ahorro-sin-fijar');
    const conMeta = document.getElementById('meta-ahorro-con-meta');
    card.classList.remove('hidden');

    const meta = Number(usuario.metaAhorro);
    if (!meta || meta <= 0) {
        sinFijar.classList.remove('hidden');
        conMeta.classList.add('hidden');
        return;
    }
    sinFijar.classList.add('hidden');
    conMeta.classList.remove('hidden');

    const saldo = Number(usuario.saldo) || 0;
    const porcentaje = Math.min(100, Math.max(0, Math.round((saldo / meta) * 100)));
    document.getElementById('meta-ahorro-barra-relleno').style.width = porcentaje + '%';
    document.getElementById('meta-ahorro-saldo-actual').textContent = saldo.toFixed(2);
    document.getElementById('meta-ahorro-objetivo').textContent = meta.toFixed(2);
    document.getElementById('meta-ahorro-porcentaje').textContent = porcentaje;
}

export function abrirModalMetaAhorro() {
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    const input = document.getElementById('meta-ahorro-input');
    input.value = usuario.metaAhorro || '';
    document.getElementById('btn-quitar-meta-ahorro').classList.toggle('hidden', !usuario.metaAhorro);
    window.openModal('meta-ahorro-modal');
}

export async function guardarCambioMetaAhorro(nuevaMeta) {
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));

    // F8 (2026-08-07, completado): guard que había quedado
    // pendiente de la tanda v96→v97 - este formulario tampoco pasa
    // por window.requiereConexionParaOperar() porque tiene su propia cola
    // offline (window.encolarAccion), igual que perfil/retiro/transferir.
    if (window.cuentaDesactivadaGlobal) {
        window.showToast('❌ Tu cuenta está desactivada. Contacta a soporte para más información.', 3500);
        window.closeModal('meta-ahorro-modal');
        return;
    }

    if (!navigator.onLine) {
        window.encolarAccion('perfil', { usuarioId: usuario.id, cambios: { meta_ahorro: nuevaMeta } });
    } else {
        const { error } = await window.supabaseClient
            .from('perfiles')
            .update({ meta_ahorro: nuevaMeta })
            .eq('id', usuario.id);
        if (error) {
            console.error(error);
            window.showToast('No se pudo guardar la meta', 3000);
            return;
        }
    }

    usuario.metaAhorro = nuevaMeta;
    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
    window.actualizarMetaAhorroInicio(usuario);
    window.closeModal('meta-ahorro-modal');
    if (navigator.onLine) window.showToast(nuevaMeta ? 'Meta guardada' : 'Meta quitada', 2000);
}

export function quitarMetaAhorro() {
    guardarCambioMetaAhorro(null);
}

if (typeof window !== 'undefined') {
    window.actualizarMetaAhorroInicio = actualizarMetaAhorroInicio;
    window.abrirModalMetaAhorro = abrirModalMetaAhorro;
    window.guardarCambioMetaAhorro = guardarCambioMetaAhorro;
    window.quitarMetaAhorro = quitarMetaAhorro;
}
