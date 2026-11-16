/**
 * CuevaCoin — js/ui/menu-dots.js
 * Puntos rojos de novedades del menú y del botón ☰ (Fase 3 / Oleada 2).
 * No incluye dots de chat (chat intacto en legacy).
 */

export const NOVEDADES_MENU = {
    'como-usar-2026-08-03': 'como-usar-dot',
    'chat-grupal-privado-2026-08-03': 'chat-grupal-privado-dot',
};

export function actualizarDotMenuUnico() {
    const dotMenu = document.getElementById('notif-dot-menu');
    const wrap = document.querySelector('.menu-toggle-wrap');
    // El aviso global del botón ☰ refleja solo notificaciones reales sin leer.
    // Las novedades de producto conservan sus puntos individuales dentro del menú.
    const hayNotif = (typeof window !== 'undefined') ? window.hayNotifSinLeerGlobal : false;
    const hayAviso = !!hayNotif;
    if (dotMenu) dotMenu.classList.toggle('hidden', !hayAviso);
    if (wrap) wrap.classList.toggle('tiene-aviso', hayAviso);
}

export function actualizarPuntosRojosMenu() {
    const vistos = JSON.parse(localStorage.getItem('cuevacoin_novedades_vistas') || '[]');
    let hayNovedadSinVer = false;
    Object.entries(NOVEDADES_MENU).forEach(([key, elId]) => {
        const visto = vistos.includes(key);
        const el = document.getElementById(elId);
        if (el) el.classList.toggle('hidden', visto);
        if (!visto) hayNovedadSinVer = true;
    });
    if (typeof window !== 'undefined') {
        window.hayNovedadMenuGlobal = hayNovedadSinVer;
    }
    actualizarDotMenuUnico();
}

export function marcarNovedadVista(key) {
    const vistos = JSON.parse(localStorage.getItem('cuevacoin_novedades_vistas') || '[]');
    if (!vistos.includes(key)) {
        vistos.push(key);
        localStorage.setItem('cuevacoin_novedades_vistas', JSON.stringify(vistos));
    }
    actualizarPuntosRojosMenu();
}

if (typeof window !== 'undefined') {
    window.NOVEDADES_MENU = NOVEDADES_MENU;
    window.actualizarDotMenuUnico = actualizarDotMenuUnico;
    window.actualizarPuntosRojosMenu = actualizarPuntosRojosMenu;
    window.marcarNovedadVista = marcarNovedadVista;
}
