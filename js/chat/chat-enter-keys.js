/**
 * CuevaCoin — js/chat/chat-enter-keys.js
 * Fase 6 — Enter en inputs de chat (delega a send* ya modularizados).
 * Comportamiento 1:1 con listeners residuales de legacy-app.js.
 */

export function setupChatEnterKeydowns() {
    const bind = (id, handler) => {
        const el = document.getElementById(id);
        if (!el || el.dataset.cuevacoinEnterBound) return;
        el.dataset.cuevacoinEnterBound = '1';
        el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                handler();
            }
        });
    };

    bind('admin-chat-input', () => {
        if (typeof window.sendAdminMessage === 'function') window.sendAdminMessage();
    });
    bind('user-chat-input', () => {
        if (typeof window.sendUserMessage === 'function') window.sendUserMessage();
    });
    bind('admin-chat-grupal-input', () => {
        if (typeof window.sendGrupalMessage === 'function') window.sendGrupalMessage('admin');
    });
    bind('user-chat-grupal-input', () => {
        if (typeof window.sendGrupalMessage === 'function') window.sendGrupalMessage('user');
    });
    bind('user-chat-privado-input', () => {
        if (typeof window.sendPrivadoMessage === 'function') window.sendPrivadoMessage();
    });
}

if (typeof window !== 'undefined') {
    window.setupChatEnterKeydowns = setupChatEnterKeydowns;
}

// Auto-setup when DOM ready (module may load before or after DOM)
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setupChatEnterKeydowns());
    } else {
        setupChatEnterKeydowns();
    }
}
