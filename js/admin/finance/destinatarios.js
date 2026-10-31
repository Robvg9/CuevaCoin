/** Fase 3 / Oleada 8 — Selector destinatarios salario/bono */

export async function abrirSelectorDestinatarios(contexto) {
    window.contextoSeleccionDestinatarios = contexto;
    const usuarios = await obtenerTrabajadoras();
    const usuariosActivos = usuarios.filter(u => u.estado === 'activo');
    const seleccionActual = contexto === 'salario'
        ? window.seleccionDestinatariosSalario
        : window.seleccionDestinatariosBono;
    const idsSeleccionados = new Set((seleccionActual || []).map(u => u.id));

    const lista = document.getElementById('selector-destinatarios-lista');
    if (!lista) return;
    lista.replaceChildren();

    if (usuariosActivos.length === 0) {
        const empty = document.createElement('p');
        empty.style.opacity = '0.8';
        empty.textContent = 'No hay trabajadoras activas.';
        lista.appendChild(empty);
    } else {
        const fragment = document.createDocumentFragment();
        usuariosActivos.forEach(u => {
            const nombre = String(u.nombre || u.usuario || 'Sin nombre');
            const correo = u.correo ? String(u.correo) : '';
            const label = document.createElement('label');
            label.className = 'selector-destinatario-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = String(u.id || '');
            checkbox.dataset.nombre = nombre;
            checkbox.checked = idsSeleccionados.has(u.id);

            const text = document.createElement('span');
            text.textContent = nombre + (correo ? ' · ' + correo : '');

            label.appendChild(checkbox);
            label.appendChild(text);
            fragment.appendChild(label);
        });
        lista.appendChild(fragment);
    }

    const buscar = document.getElementById('selector-destinatarios-buscar');
    if (buscar) buscar.value = '';
    const todos = document.getElementById('selector-todos-checkbox');
    if (todos) {
        todos.checked = usuariosActivos.length > 0 && idsSeleccionados.size === usuariosActivos.length;
    }
    window.openModal('seleccionar-destinatarios-modal');
}

export function filtrarSelectorDestinatarios() {
    const buscar = document.getElementById('selector-destinatarios-buscar');
    const q = (buscar?.value || '').trim().toLowerCase();
    document.querySelectorAll('#selector-destinatarios-lista .selector-destinatario-item').forEach(item => {
        const coincide = q === '' || item.textContent.toLowerCase().includes(q);
        item.classList.toggle('hidden', !coincide);
    });
}

export function toggleTodosSelectorDestinatarios(checkboxTodos) {
    document.querySelectorAll('#selector-destinatarios-lista .selector-destinatario-item').forEach(item => {
        if (!item.classList.contains('hidden')) {
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (checkbox) checkbox.checked = checkboxTodos.checked;
        }
    });
}

export function actualizarResumenDestinatarios(contexto) {
    const seleccion = contexto === 'salario'
        ? window.seleccionDestinatariosSalario
        : window.seleccionDestinatariosBono;
    const resumenEl = document.getElementById(
        contexto === 'salario' ? 'salario-destinatarios-resumen' : 'bono-destinatarios-resumen'
    );
    if (!resumenEl) return;
    if (!seleccion || seleccion.length === 0) {
        resumenEl.textContent = 'Nadie seleccionado todavía';
    } else if (seleccion.length <= 3) {
        resumenEl.textContent = seleccion.map(u => String(u.nombre || '')).join(', ');
    } else {
        resumenEl.textContent = `${seleccion.length} trabajadoras seleccionadas`;
    }
}

export function confirmarSelectorDestinatarios() {
    const seleccion = Array.from(
        document.querySelectorAll('#selector-destinatarios-lista input[type="checkbox"]:checked')
    ).map(chk => ({ id: chk.value, nombre: chk.dataset.nombre }));

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
