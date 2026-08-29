/** Fase 3 / Oleada 8 — Selector destinatarios salario/bono */

export async function abrirSelectorDestinatarios(contexto) {
    window.contextoSeleccionDestinatarios = contexto;
    const usuarios = await obtenerTrabajadoras();
    const usuariosActivos = usuarios.filter(u => u.estado === 'activo');
    const seleccionActual = contexto === 'salario' ? window.seleccionDestinatariosSalario : window.seleccionDestinatariosBono;
    const idsSeleccionados = new Set(seleccionActual.map(u => u.id));

    const lista = document.getElementById('selector-destinatarios-lista');
    lista.innerHTML = usuariosActivos.map(u => `
        <label class="selector-destinatario-item">
            <input type="checkbox" value="${u.id}" data-nombre="${(u.nombre || u.usuario).replace(/"/g, '&quot;')}" ${idsSeleccionados.has(u.id) ? 'checked' : ''}>
            <span>${u.nombre || u.usuario}${u.correo ? ' · ' + u.correo : ''}</span>
        </label>
    `).join('') || '<p style="opacity: 0.8;">No hay trabajadoras activas.</p>';

    document.getElementById('selector-destinatarios-buscar').value = '';
    document.getElementById('selector-todos-checkbox').checked = usuariosActivos.length > 0 && idsSeleccionados.size === usuariosActivos.length;
    window.openModal('seleccionar-destinatarios-modal');
}

export function filtrarSelectorDestinatarios() {
    const q = document.getElementById('selector-destinatarios-buscar').value.trim().toLowerCase();
    document.querySelectorAll('#selector-destinatarios-lista .selector-destinatario-item').forEach(item => {
        const coincide = q === '' || item.textContent.toLowerCase().includes(q);
        item.classList.toggle('hidden', !coincide);
    });
}

export function toggleTodosSelectorDestinatarios(checkboxTodos) {
    document.querySelectorAll('#selector-destinatarios-lista .selector-destinatario-item').forEach(item => {
        if (!item.classList.contains('hidden')) {
            item.querySelector('input[type="checkbox"]').checked = checkboxTodos.checked;
        }
    });
}

export function actualizarResumenDestinatarios(contexto) {
    const seleccion = contexto === 'salario' ? window.seleccionDestinatariosSalario : window.seleccionDestinatariosBono;
    const resumenEl = document.getElementById(contexto === 'salario' ? 'salario-destinatarios-resumen' : 'bono-destinatarios-resumen');
    if (!resumenEl) return;
    if (seleccion.length === 0) {
        resumenEl.textContent = 'Nadie seleccionado todavía';
    } else if (seleccion.length <= 3) {
        resumenEl.textContent = seleccion.map(u => u.nombre).join(', ');
    } else {
        resumenEl.textContent = `${seleccion.length} trabajadoras seleccionadas`;
    }
}

export function confirmarSelectorDestinatarios() {
    const seleccion = Array.from(document.querySelectorAll('#selector-destinatarios-lista input[type="checkbox"]:checked'))
        .map(chk => ({ id: chk.value, nombre: chk.dataset.nombre }));
    if (window.contextoSeleccionDestinatarios === 'salario') {
        window.seleccionDestinatariosSalario = seleccion;
        actualizarResumenDestinatarios('salario');
    } else if (window.contextoSeleccionDestinatarios === 'bono') {
        window.seleccionDestinatariosBono = seleccion;
        actualizarResumenDestinatarios('bono');
    }
    window.closeModal('seleccionar-destinatarios-modal');
}

if (typeof window !== 'undefined') {
    window.abrirSelectorDestinatarios = abrirSelectorDestinatarios;
    window.filtrarSelectorDestinatarios = filtrarSelectorDestinatarios;
    window.toggleTodosSelectorDestinatarios = toggleTodosSelectorDestinatarios;
    window.actualizarResumenDestinatarios = actualizarResumenDestinatarios;
    window.confirmarSelectorDestinatarios = confirmarSelectorDestinatarios;
}
