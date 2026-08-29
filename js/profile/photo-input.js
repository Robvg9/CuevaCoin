/**
 * CuevaCoin — js/profile/photo-input.js
 * Selección de archivo + inicialización de Cropper.js (Oleada 5).
 * La subida real vive en profile/photo.js (subirFotoPerfil).
 */

export function onPerfilFotoInputChange(e) {
    const archivo = e.target && e.target.files && e.target.files[0];
    if (!archivo) return;

    if (typeof window !== 'undefined' && window.urlObjetoFotoPerfilTemp) {
        try { URL.revokeObjectURL(window.urlObjetoFotoPerfilTemp); } catch (err) { /* ignore */ }
    }

    const urlTemp = URL.createObjectURL(archivo);
    if (typeof window !== 'undefined') {
        window.urlObjetoFotoPerfilTemp = urlTemp;
    }

    const imgRecorte = document.getElementById('img-recorte-foto');
    if (!imgRecorte) return;
    imgRecorte.src = urlTemp;

    if (typeof window !== 'undefined' && window.openModal) {
        // El monolito usa 'crop-foto-modal' o 'recorte-foto-modal' según versión;
        // se prueba el id que exista.
        if (document.getElementById('crop-foto-modal')) {
            window.openModal('crop-foto-modal');
        } else if (document.getElementById('recorte-foto-modal')) {
            window.openModal('recorte-foto-modal');
        }
    }

    imgRecorte.onload = function () {
        if (typeof window !== 'undefined' && window.cropperFotoPerfil) {
            try { window.cropperFotoPerfil.destroy(); } catch (err) { /* ignore */ }
        }
        if (typeof Cropper === 'undefined') return;
        const cropper = new Cropper(imgRecorte, {
            aspectRatio: 1,
            viewMode: 1,
            dragMode: 'move',
            autoCropArea: 1,
            cropBoxResizable: false,
            cropBoxMovable: false,
            background: false,
            guides: false,
            center: false,
            highlight: false
        });
        if (typeof window !== 'undefined') {
            window.cropperFotoPerfil = cropper;
        }
    };

    e.target.value = '';
}

export function setupPerfilFotoInput() {
    const input = document.getElementById('perfil-foto-input');
    if (!input || input.dataset.cuevacoinBound) return;
    input.dataset.cuevacoinBound = '1';
    input.addEventListener('change', onPerfilFotoInputChange);
}

if (typeof window !== 'undefined') {
    window.onPerfilFotoInputChange = onPerfilFotoInputChange;
    window.setupPerfilFotoInput = setupPerfilFotoInput;
}
