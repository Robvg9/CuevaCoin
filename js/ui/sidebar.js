/**
 * CuevaCoin — js/ui/sidebar.js
 * Sidebar, overlay y submenús (Fase 3 / Oleada 2).
 */

export function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    const mainContent = document.querySelector('.main-content');

    if (!sidebar || !overlay) return;
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');

    if (mainContent) {
        mainContent.style.overflow = sidebar.classList.contains('open') ? 'hidden' : 'auto';
    }
}

export function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    const mainContent = document.querySelector('.main-content');

    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');

    if (mainContent) {
        mainContent.style.overflow = 'auto';
    }
}

export function toggleSubmenu(submenuId) {
    const submenu = document.getElementById(`${submenuId}-submenu`);
    if (submenu) submenu.classList.toggle('open');
}

if (typeof window !== 'undefined') {
    window.toggleSidebar = toggleSidebar;
    window.closeSidebar = closeSidebar;
    window.toggleSubmenu = toggleSubmenu;
}
