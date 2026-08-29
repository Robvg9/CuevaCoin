/**
 * CuevaCoin — js/profile/profile-ui.js
 * UI de perfil propio (render + frase) — Oleada 3.
 * Muestra saldo en DOM (solo lectura visual); no opera finanzas.
 */

export function actualizarFrasePersonalInicio(frasePersonal) {
    const el = document.getElementById('user-frase-personal');
    if (!el) return;
    el.textContent = frasePersonal || '';
    el.classList.toggle('hidden', !frasePersonal);
}

export function loadUserPerfil(usuario) {
    if (!usuario) return;
    const formatear = (typeof window !== 'undefined' && window.formatearUltimaVez)
        ? window.formatearUltimaVez : (v) => v || '';
    const separar = (typeof window !== 'undefined' && window.separarTelefono)
        ? window.separarTelefono : () => ({ prefijo: '', numero: '' });
    const actualizarEstado = (typeof window !== 'undefined' && window.actualizarEstadoPerfil)
        ? window.actualizarEstadoPerfil : () => {};

    const avatar = document.getElementById('perfil-avatar');
    if (avatar) {
        avatar.src = usuario.foto || `https://ui-avatars.com/api/?name=${usuario.usuario}&background=2563EB&color=fff`;
    }
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('perfil-nombre', usuario.nombre || usuario.usuario);
    set('perfil-usuario', usuario.usuario);
    const saldoEl = document.getElementById('perfil-saldo');
    if (saldoEl) saldoEl.textContent = Number(usuario.saldo || 0).toFixed(2);
    set('perfil-ultima-conexion', formatear(usuario.ultimaConexion));

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('datos-nombre', usuario.nombre || '');
    setVal('datos-apellido', usuario.apellido || '');
    setVal('datos-numero-carnet', usuario.numeroCarnet || '');
    setVal('datos-fecha-nacimiento', usuario.fechaNacimiento || '');
    setVal('datos-correo', usuario.correo || '');

    const correoYaCargado = !!(usuario.correo);
    const correoBloqueado = correoYaCargado && !usuario.esAdmin;
    const inputCorreo = document.getElementById('datos-correo');
    if (inputCorreo) {
        inputCorreo.readOnly = correoBloqueado;
        inputCorreo.classList.toggle('input-bloqueado', correoBloqueado);
    }
    const nota = document.getElementById('datos-correo-bloqueado-nota');
    if (nota) nota.classList.toggle('hidden', !correoBloqueado);

    const { prefijo, numero } = separar(usuario.telefono);
    setVal('datos-telefono-prefijo', prefijo);
    setVal('datos-telefono', numero);
    setVal('datos-frase-personal', usuario.frasePersonal || '');

    actualizarEstado(usuario);
}

if (typeof window !== 'undefined') {
    window.actualizarFrasePersonalInicio = actualizarFrasePersonalInicio;
    window.loadUserPerfil = loadUserPerfil;
}
