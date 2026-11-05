/**
 * CuevaCoin — js/ui/modals.js
 * Modales genéricos (Fase 3 / Oleada 2).
 * Comportamiento 1:1. Sin lógica financiera.
 */

export function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'block';
}

export function closeModal(modalId) {
    if (modalId === 'pagar-salario-modal' && typeof window !== 'undefined'
        && typeof window.resetearFormularioSalario === 'function') {
        try { window.resetearFormularioSalario(); }
        catch (error) { console.warn('[CuevaCoin] No se pudo limpiar el formulario salarial:', error); }
    }
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
}

if (typeof window !== 'undefined') {
    window.openModal = openModal;
    window.closeModal = closeModal;
}
