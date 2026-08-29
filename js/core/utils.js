/**
 * CuevaCoin — js/core/utils.js
 * Utilidades puras / helpers de bajo nivel (Fase 2 / Oleada 1).
 * Comportamiento 1:1 con el monolito original (v125).
 * No contiene lógica financiera, retiros, transferencias ni cola.
 */

// ============================================
// TOAST
// ============================================
export function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// ============================================
// OVERLAY CARGANDO
// ============================================
export function mostrarCargando() {
    const el = document.getElementById('overlay-cargando');
    if (el) el.classList.remove('hidden');
}

export function ocultarCargando() {
    const el = document.getElementById('overlay-cargando');
    if (el) el.classList.add('hidden');
}

// ============================================
// XSS / HTML seguro
// ============================================
export function escapeHTML(texto) {
    const div = document.createElement('div');
    div.textContent = texto == null ? '' : String(texto);
    return div.innerHTML;
}

// ============================================
// ERRORES DE RED
// ============================================
export function esErrorDeConexion(err) {
    if (!navigator.onLine) return true;
    const mensaje = (err && (err.message || err.name || err.code || '')) + '';
    return /fetch|network|conexión|conexion|internet|NetworkError|retryable|timeout|load failed|ERR_INTERNET|ERR_NETWORK/i.test(mensaje);
}

// ============================================
// MONTOS ENTEROS
// ============================================
export function esMontoEnteroValido(valorCrudo) {
    const numero = Number(valorCrudo);
    return Number.isInteger(numero) && numero > 0;
}

// ============================================
// IDEMPOTENCY KEY (pura — sin sessionStorage)
// ============================================
export function generarIdempotencyKey() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'ret-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
}

// ============================================
// MENSAJE DE ERROR DE EDGE FUNCTIONS
// ============================================
export async function extraerMensajeErrorEdgeFunction(error, data) {
    if (data && data.error) return data.error;
    if (error && error.context && typeof error.context.json === 'function') {
        try {
            const cuerpo = await error.context.clone().json();
            if (cuerpo && cuerpo.error) return cuerpo.error;
        } catch (e) {
            // el body no era JSON legible — seguir al mensaje genérico
        }
    }
    return (error && error.message) || 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}

// ============================================
// EMAIL INTERNO (usuario → email local)
// ============================================
export function usuarioAEmail(usuario) {
    return `${usuario.trim().toLowerCase()}@cuevacoin.local`;
}

// ============================================
// PERFIL COMPLETO (cálculo puro)
// ============================================
export function calcularPerfilCompleto(datos) {
    const campos = [datos.nombre, datos.apellido, datos.numeroCarnet, datos.fechaNacimiento, datos.correo, datos.telefono];
    return campos.every(c => c !== null && c !== undefined && String(c).trim() !== '');
}

// ============================================
// TELÉFONO: banderas + lista de países + separación
// ============================================
export function banderaDesdeIso(iso2) {
    return iso2.toUpperCase().split('').map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
}

export const PAISES_TELEFONO = [
    { iso: 'MX', dial: '+52', nombre: 'México' },
    { iso: 'GT', dial: '+502', nombre: 'Guatemala' },
    { iso: 'SV', dial: '+503', nombre: 'El Salvador' },
    { iso: 'HN', dial: '+504', nombre: 'Honduras' },
    { iso: 'NI', dial: '+505', nombre: 'Nicaragua' },
    { iso: 'CR', dial: '+506', nombre: 'Costa Rica' },
    { iso: 'PA', dial: '+507', nombre: 'Panamá' },
    { iso: 'CU', dial: '+53', nombre: 'Cuba' },
    { iso: 'DO', dial: '+1', nombre: 'República Dominicana' },
    { iso: 'PR', dial: '+1', nombre: 'Puerto Rico' },
    { iso: 'US', dial: '+1', nombre: 'Estados Unidos' },
    { iso: 'CA', dial: '+1', nombre: 'Canadá' },
    { iso: 'CO', dial: '+57', nombre: 'Colombia' },
    { iso: 'VE', dial: '+58', nombre: 'Venezuela' },
    { iso: 'EC', dial: '+593', nombre: 'Ecuador' },
    { iso: 'PE', dial: '+51', nombre: 'Perú' },
    { iso: 'BO', dial: '+591', nombre: 'Bolivia' },
    { iso: 'PY', dial: '+595', nombre: 'Paraguay' },
    { iso: 'UY', dial: '+598', nombre: 'Uruguay' },
    { iso: 'AR', dial: '+54', nombre: 'Argentina' },
    { iso: 'CL', dial: '+56', nombre: 'Chile' },
    { iso: 'BR', dial: '+55', nombre: 'Brasil' },
    { iso: 'ES', dial: '+34', nombre: 'España' },
    { iso: 'GB', dial: '+44', nombre: 'Reino Unido' },
    { iso: 'FR', dial: '+33', nombre: 'Francia' },
    { iso: 'DE', dial: '+49', nombre: 'Alemania' },
    { iso: 'IT', dial: '+39', nombre: 'Italia' },
    { iso: 'PT', dial: '+351', nombre: 'Portugal' },
    { iso: 'CN', dial: '+86', nombre: 'China' },
    { iso: 'JP', dial: '+81', nombre: 'Japón' },
    { iso: 'IN', dial: '+91', nombre: 'India' }
];

export function separarTelefono(telefonoCompleto) {
    if (!telefonoCompleto) return { prefijo: '', numero: '' };
    const prefijos = PAISES_TELEFONO.map(p => p.dial).sort((a, b) => b.length - a.length);
    const encontrado = prefijos.find(dial => telefonoCompleto.startsWith(dial));
    if (encontrado) {
        return { prefijo: encontrado, numero: telefonoCompleto.slice(encontrado.length).trim() };
    }
    return { prefijo: '', numero: telefonoCompleto };
}

/** Llena el <select id="datos-telefono-prefijo"> (idempotente). */
export function llenarSelectorPrefijos() {
    const select = document.getElementById('datos-telefono-prefijo');
    if (!select || select.options.length > 0) return;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'País';
    select.appendChild(placeholder);
    PAISES_TELEFONO.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.dial;
        opt.textContent = `${banderaDesdeIso(p.iso)} ${p.dial}`;
        opt.title = p.nombre;
        select.appendChild(opt);
    });
}

// ============================================
// FECHAS LEGIBLES
// ============================================
export function formatearFechaSeparador(fechaISO) {
    const d = new Date(fechaISO);
    const hoy = new Date();
    const ayer = new Date();
    ayer.setDate(hoy.getDate() - 1);
    const mismoDia = (a, b) => a.toDateString() === b.toDateString();
    if (mismoDia(d, hoy)) return 'Hoy';
    if (mismoDia(d, ayer)) return 'Ayer';
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatearUltimaVez(fechaISO) {
    if (!fechaISO) return 'N/A';
    const fecha = new Date(fechaISO);
    if (isNaN(fecha.getTime())) return 'N/A';

    const ahora = new Date();
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const inicioAyer = new Date(inicioHoy);
    inicioAyer.setDate(inicioAyer.getDate() - 1);
    const inicioFecha = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());

    let horas12 = fecha.getHours() % 12;
    if (horas12 === 0) horas12 = 12;
    const minutos = fecha.getMinutes().toString().padStart(2, '0');
    const ampm = fecha.getHours() >= 12 ? 'PM' : 'AM';
    const horaFormateada = `${horas12.toString().padStart(2, '0')}:${minutos}${ampm}`;

    if (inicioFecha.getTime() === inicioHoy.getTime()) {
        return `${horaFormateada} Hoy`;
    } else if (inicioFecha.getTime() === inicioAyer.getTime()) {
        return `${horaFormateada} Ayer`;
    }

    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const dia = fecha.getDate().toString().padStart(2, '0');
    return `${dia} de ${meses[fecha.getMonth()]}`;
}

// ============================================
// Compatibilidad con el monolito (onclick / scripts clásicos)
// ============================================
if (typeof window !== 'undefined') {
    window.showToast = showToast;
    window.mostrarCargando = mostrarCargando;
    window.ocultarCargando = ocultarCargando;
    window.escapeHTML = escapeHTML;
    window.esErrorDeConexion = esErrorDeConexion;
    window.esMontoEnteroValido = esMontoEnteroValido;
    window.generarIdempotencyKey = generarIdempotencyKey;
    window.extraerMensajeErrorEdgeFunction = extraerMensajeErrorEdgeFunction;
    window.usuarioAEmail = usuarioAEmail;
    window.calcularPerfilCompleto = calcularPerfilCompleto;
    window.banderaDesdeIso = banderaDesdeIso;
    window.PAISES_TELEFONO = PAISES_TELEFONO;
    window.separarTelefono = separarTelefono;
    window.llenarSelectorPrefijos = llenarSelectorPrefijos;
    window.formatearFechaSeparador = formatearFechaSeparador;
    window.formatearUltimaVez = formatearUltimaVez;
}
