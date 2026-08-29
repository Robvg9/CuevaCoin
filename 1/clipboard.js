/**
 * CuevaCoin — js/ui/clipboard.js
 * Copiar correo al portapapeles (Fase 3 / Oleada 2).
 */

export function copiarCorreoFallback(texto) {
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const textarea = document.createElement('textarea');
    textarea.value = texto;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        toast('📋 Correo copiado', 2000);
    } catch (e) {
        toast(`No se pudo copiar. Tu correo es: ${texto}`, 5000);
    }
    document.body.removeChild(textarea);
}

export function copiarCorreoUsuario() {
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const correoSpan = document.getElementById('user-correo');
    const correo = (correoSpan && correoSpan.dataset.correo) || '';
    if (!correo) {
        toast('Completa tu perfil para tener un correo registrado', 3000);
        return;
    }
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(correo)
            .then(() => toast('📋 Correo copiado', 2000))
            .catch(() => copiarCorreoFallback(correo));
    } else {
        copiarCorreoFallback(correo);
    }
}

if (typeof window !== 'undefined') {
    window.copiarCorreoUsuario = copiarCorreoUsuario;
    window.copiarCorreoFallback = copiarCorreoFallback;
}
