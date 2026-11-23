/**
 * FORTUNA v1 — navegación local de la vista previa.
 * No importa el cliente de datos ni envía operaciones.
 */
function inicializarPestanasFortuna() {
    const root = document.getElementById('admin-fortuna');
    if (!root || root.dataset.fortunaTabsReady === 'true') return;
    root.dataset.fortunaTabsReady = 'true';

    const tabs = Array.from(root.querySelectorAll('[data-fortuna-tab]'));
    const panels = Array.from(root.querySelectorAll('[data-fortuna-panel]'));
    if (!tabs.length || !panels.length) return;

    const activate = (key) => {
        const activeTab = tabs.find((tab) => tab.dataset.fortunaTab === key);
        const activePanel = panels.find((panel) => panel.dataset.fortunaPanel === key);
        if (!activeTab || !activePanel) return;
        tabs.forEach((tab) => {
            const selected = tab === activeTab;
            tab.classList.toggle('is-active', selected);
            tab.setAttribute('aria-selected', selected ? 'true' : 'false');
            tab.tabIndex = selected ? 0 : -1;
        });
        panels.forEach((panel) => { panel.hidden = panel !== activePanel; });
    };

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activate(tab.dataset.fortunaTab));
        tab.addEventListener('keydown', (event) => {
            let nextIndex = null;
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
            if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = tabs.length - 1;
            if (nextIndex === null) return;
            event.preventDefault();
            tabs[nextIndex].focus();
            activate(tabs[nextIndex].dataset.fortunaTab);
        });
    });
    activate('overview');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarPestanasFortuna, { once: true });
} else {
    inicializarPestanasFortuna();
}
