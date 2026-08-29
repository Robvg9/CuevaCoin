/**
 * CuevaCoin — js/ui/theme.js
 * Tamaño de letra y paleta de colores (Fase 3 / Oleada 2).
 * seleccionarColorAcento usa window.encolarAccion / supabaseClient si existen.
 */

export const ZOOM_POR_TAMANO = { 'normal': '1', 'grande': '1.15', 'muy-grande': '1.3' };

export const PALETA_ACENTOS = {
    rosa:     { primary: '#FFB6C1', secondary: '#FF69B4', light: '#FFF0F5', dark: '#E6E6FA', border: '#FFB6C1', bg: '#FFF5F7', primaryDark: '#F5479E', secondaryDark: '#FF69B4', borderDark: '#BC2F75', sidebar: ['#FFB6C1', '#E6E6FA', '#FFD1DC'] },
    azul:     { primary: '#176CD3', secondary: '#236DC7', light: '#ECF4FD', dark: '#E3E8FC', border: '#176CD3', bg: '#F5F9FE', primaryDark: '#438EEA', secondaryDark: '#236DC7', borderDark: '#42699A', sidebar: ['#1973E1', '#0B3C82', '#BFD9FA'] },
    grafito:  { primary: '#5F74A5', secondary: '#697696', light: '#F1F3F8', dark: '#EBECF4', border: '#5F74A5', bg: '#F6F8FB', primaryDark: '#798BB4', secondaryDark: '#697696', borderDark: '#5D677E', sidebar: ['#1E293B', '#3A3A3A', '#C9A227'] },
    verde:    { primary: '#0F854E', secondary: '#188653', light: '#ECFDF5', dark: '#E3FCF7', border: '#0F854E', bg: '#F0FDF7', primaryDark: '#14B86B', secondaryDark: '#188653', borderDark: '#327656', sidebar: ['#0F854E', '#14532D', '#B7F0CE'] },
    morado:   { primary: '#8255EC', secondary: '#835AE2', light: '#F1ECFD', dark: '#F1E3FC', border: '#8255EC', bg: '#F6F2FE', primaryDark: '#9A75F0', secondaryDark: '#835AE2', borderDark: '#7457B7', sidebar: ['#7C4CEB', '#3B0764', '#E9D8FD'] },
    naranja:  { primary: '#BC5B15', secondary: '#B65F20', light: '#FDF3EC', dark: '#FCF4E3', border: '#BC5B15', bg: '#FEF6F0', primaryDark: '#E16C19', secondaryDark: '#B65F20', borderDark: '#8B5D3C', sidebar: ['#E16C19', '#B8330A', '#FFD59E'] },
    vino:     { primary: '#D81838', secondary: '#DB334F', light: '#FDECEF', dark: '#FCE5E3', border: '#D81838', bg: '#FEF2F4', primaryDark: '#ED5A72', secondaryDark: '#DB334F', borderDark: '#A84858', sidebar: ['#D81838', '#4A0E1E', '#F3C6CE'] },
    neon:     { primary: '#07768D', secondary: '#0B788E', light: '#EDFAFD', dark: '#E5EEFA', border: '#07768D', bg: '#F2FCFE', primaryDark: '#0AA3C2', secondaryDark: '#0B788E', borderDark: '#30717E', sidebar: ['#FF00E6', '#00E5FF', '#CCFF00'] }
};

export const PALETA_ACENTOS_MIGRACION = {
    lavanda: 'morado', menta: 'verde', amarillo: 'naranja', celeste: 'azul', coral: 'naranja'
};

export function aplicarTamanoLetra(tamano) {
    document.documentElement.style.setProperty('--ui-zoom', ZOOM_POR_TAMANO[tamano] || '1');
    document.querySelectorAll('.js-tamano-letra-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tamano === tamano);
    });
}

export function cambiarTamanoLetra(tamano) {
    localStorage.setItem('cuevacoin_tamano_letra', tamano);
    aplicarTamanoLetra(tamano);
}

export function resolverClavePaleta(clave) {
    if (PALETA_ACENTOS[clave]) return clave;
    return PALETA_ACENTOS_MIGRACION[clave] || 'rosa';
}

export function aplicarColorAcento(claveOriginal) {
    const clave = resolverClavePaleta(claveOriginal);
    const paleta = PALETA_ACENTOS[clave];
    if (!paleta) return;
    const raiz = document.documentElement;
    const esOscuro = raiz.getAttribute('data-theme') === 'dark';

    raiz.style.setProperty('--accent-primary', paleta.secondary);
    raiz.style.setProperty('--accent-secondary', paleta.primary);

    const sb = paleta.sidebar || [paleta.primary, paleta.secondary, paleta.light];
    raiz.style.setProperty('--sidebar-c1', sb[0]);
    raiz.style.setProperty('--sidebar-c2', sb[1]);
    raiz.style.setProperty('--sidebar-c3', sb[2]);

    if (esOscuro) {
        raiz.style.setProperty('--primary-color', paleta.primaryDark);
        raiz.style.setProperty('--secondary-color', paleta.secondaryDark);
        raiz.style.setProperty('--border-color', paleta.borderDark);
        raiz.style.removeProperty('--light-color');
        raiz.style.removeProperty('--dark-color');
        raiz.style.removeProperty('--bg-color');
    } else {
        raiz.style.setProperty('--primary-color', paleta.primary);
        raiz.style.setProperty('--secondary-color', paleta.secondary);
        raiz.style.setProperty('--border-color', paleta.border);
        raiz.style.setProperty('--light-color', paleta.light);
        raiz.style.setProperty('--dark-color', paleta.dark);
        raiz.style.setProperty('--bg-color', paleta.bg);
    }

    document.querySelectorAll('.color-acento-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.clave === clave);
    });
}

export function renderColorAcentoSwatches(claveActiva) {
    const cont = document.getElementById('color-acento-swatches');
    if (!cont || cont.childElementCount) return;
    const NOMBRES = {
        rosa: 'Rosa', azul: 'Azul (profesional)', grafito: 'Caballero (elegante)',
        verde: 'Verde (natural)', morado: 'Morado (real)', naranja: 'Naranja (energético)',
        vino: 'Vino (sofisticado)', neon: 'Neón (llamativo)'
    };
    Object.entries(PALETA_ACENTOS).forEach(([clave, colores]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'color-acento-swatch';
        btn.dataset.clave = clave;
        btn.title = NOMBRES[clave] || clave;
        const sb = colores.sidebar || [colores.secondary, colores.primary, colores.light];
        btn.style.background = `linear-gradient(135deg, ${sb[0]} 0%, ${sb[1]} 50%, ${sb[2]} 100%)`;
        btn.onclick = () => {
            if (typeof window !== 'undefined' && typeof window.seleccionarColorAcento === 'function') {
                window.seleccionarColorAcento(clave);
            }
        };
        cont.appendChild(btn);
    });
    document.querySelectorAll('.color-acento-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.clave === resolverClavePaleta(claveActiva));
    });
}

export async function seleccionarColorAcento(clave) {
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    aplicarColorAcento(clave);

    if (!usuario) return;

    if (!navigator.onLine) {
        if (typeof window !== 'undefined' && typeof window.encolarAccion === 'function') {
            window.encolarAccion('perfil', { usuarioId: usuario.id, cambios: { color_acento: clave } });
        }
    } else {
        const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
        if (client) {
            const { error } = await client
                .from('perfiles')
                .update({ color_acento: clave })
                .eq('id', usuario.id);
            if (error) {
                console.error(error);
                toast('No se pudo guardar el color', 3000);
                return;
            }
        }
    }

    usuario.colorAcento = clave;
    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
    if (navigator.onLine) toast('Color actualizado', 2000);
}

if (typeof window !== 'undefined') {
    window.ZOOM_POR_TAMANO = ZOOM_POR_TAMANO;
    window.PALETA_ACENTOS = PALETA_ACENTOS;
    window.PALETA_ACENTOS_MIGRACION = PALETA_ACENTOS_MIGRACION;
    window.aplicarTamanoLetra = aplicarTamanoLetra;
    window.cambiarTamanoLetra = cambiarTamanoLetra;
    window.resolverClavePaleta = resolverClavePaleta;
    window.aplicarColorAcento = aplicarColorAcento;
    window.renderColorAcentoSwatches = renderColorAcentoSwatches;
    window.seleccionarColorAcento = seleccionarColorAcento;
}
