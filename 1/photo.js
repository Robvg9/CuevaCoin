/**
 * CuevaCoin — js/profile/photo.js
 * Menú de foto, cropper y subida vía Edge Function subir-foto-perfil.
 * Oleada 3. No toca retiros/transferencias/cola.
 */

export function abrirMenuFotoPerfil() {
    if (typeof window !== 'undefined' && window.openModal) window.openModal('foto-perfil-menu-modal');
}

export function verFotoPerfilActual() {
    if (typeof window !== 'undefined' && window.closeModal) window.closeModal('foto-perfil-menu-modal');
    const img = document.getElementById('ver-foto-imagen');
    const avatar = document.getElementById('perfil-avatar');
    if (img && avatar) img.src = avatar.src;
    if (typeof window !== 'undefined' && window.openModal) window.openModal('ver-foto-modal');
}

export function cambiarFotoPerfilClick() {
    if (typeof window !== 'undefined' && window.closeModal) window.closeModal('foto-perfil-menu-modal');
    const input = document.getElementById('perfil-foto-input');
    if (input) input.click();
}

export function cancelarRecorteFoto() {
    if (typeof window !== 'undefined' && window.cropperFotoPerfil) {
        try { window.cropperFotoPerfil.destroy(); } catch (e) { /* ignore */ }
        window.cropperFotoPerfil = null;
    }
    if (typeof window !== 'undefined' && window.urlObjetoFotoPerfilTemp) {
        try { URL.revokeObjectURL(window.urlObjetoFotoPerfilTemp); } catch (e) { /* ignore */ }
        window.urlObjetoFotoPerfilTemp = null;
    }
    if (typeof window !== 'undefined' && window.closeModal) window.closeModal('recorte-foto-modal');
    const input = document.getElementById('perfil-foto-input');
    if (input) input.value = '';
}

export function guardarRecorteFoto() {
    const cropper = (typeof window !== 'undefined') ? window.cropperFotoPerfil : null;
    if (!cropper) return;
    const btnGuardar = document.getElementById('btn-guardar-recorte');
    if (btnGuardar) {
        btnGuardar.disabled = true;
        btnGuardar.textContent = 'Procesando...';
    }
    cropper.getCroppedCanvas({ width: 512, height: 512 }).toBlob(async (blob) => {
        if (!blob) {
            if (btnGuardar) {
                btnGuardar.disabled = false;
                btnGuardar.textContent = 'Usar esta foto';
            }
            return;
        }
        await subirFotoPerfil(blob);
        cancelarRecorteFoto();
        if (btnGuardar) {
            btnGuardar.disabled = false;
            btnGuardar.textContent = 'Usar esta foto';
        }
    }, 'image/jpeg', 0.85);
}

export async function subirFotoPerfil(archivo) {
    const requiere = (typeof window !== 'undefined' && window.requiereConexionParaOperar)
        ? window.requiereConexionParaOperar : () => true;
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    const extraer = (typeof window !== 'undefined' && window.extraerMensajeErrorEdgeFunction)
        ? window.extraerMensajeErrorEdgeFunction
        : async (err, data) => (data && data.error) || (err && err.message) || 'Error';

    if (!requiere()) return;
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    if (!usuario || !client) return;

    const archivoBase64 = await new Promise((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () => {
            const resultado = lector.result;
            const coma = String(resultado).indexOf(',');
            resolve(coma >= 0 ? String(resultado).slice(coma + 1) : resultado);
        };
        lector.onerror = () => reject(lector.error);
        lector.readAsDataURL(archivo);
    });

    toast('Subiendo foto...', 2000);

    const { data: respuesta, error: errorInvoke } = await client.functions.invoke('subir-foto-perfil', {
        body: { archivo_base64: archivoBase64, contentType: 'image/jpeg' }
    });

    if (errorInvoke || !respuesta || respuesta.error) {
        console.error('Error subiendo la foto de perfil:', errorInvoke || respuesta);
        const mensajeError = await extraer(errorInvoke, respuesta);
        toast(`No se pudo subir la foto: ${mensajeError}`, 4500);
        return;
    }

    const publicUrl = respuesta.publicUrl;
    const urlParaMostrar = `${publicUrl}?t=${Date.now()}`;

    usuario.foto = publicUrl;
    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));

    const perfilAvatar = document.getElementById('perfil-avatar');
    const topbarAvatar = document.getElementById('topbar-avatar');
    if (perfilAvatar) perfilAvatar.src = urlParaMostrar;
    if (topbarAvatar) topbarAvatar.src = urlParaMostrar;
    toast('¡Foto de perfil actualizada!', 3000);
}

if (typeof window !== 'undefined') {
    window.abrirMenuFotoPerfil = abrirMenuFotoPerfil;
    window.verFotoPerfilActual = verFotoPerfilActual;
    window.cambiarFotoPerfilClick = cambiarFotoPerfilClick;
    window.cancelarRecorteFoto = cancelarRecorteFoto;
    window.guardarRecorteFoto = guardarRecorteFoto;
    window.subirFotoPerfil = subirFotoPerfil;
}
