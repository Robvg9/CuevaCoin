/** CuevaCoin — selección para bonos + destinatarias inline y montos por trabajadora para salario. */
let salaryWorkers = [];
let salaryRows = new Map();
let salaryLocked = false;

function recipientText(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = value == null ? '' : String(value);
    return el;
}
function pendingSalary() {
    try {
        const raw = sessionStorage.getItem('cuevacoin_salary_batch_pending');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed.key === 'string' && Array.isArray(parsed.payload) ? parsed : null;
    } catch (_error) { return null; }
}
function syncSalarySelection() {
    const selected = [...salaryRows.values()].filter(row => row.selected).map(row => ({
        id: row.id, nombre: row.nombre, monto: row.amount, dias: [...row.days].sort()
    }));
    window.seleccionDestinatariosSalario = selected;
    const summary = document.getElementById('salario-destinatarios-resumen');
    if (summary) summary.textContent = selected.length
        ? selected.length + (selected.length === 1 ? ' trabajadora seleccionada' : ' trabajadoras seleccionadas')
        : 'Selecciona las trabajadoras y define su monto y días trabajados.';
}
function renderDays(state, container) {
    container.replaceChildren();
    state.days.forEach(day => {
        const chip = document.createElement('span');
        chip.className = 'salario-dia-chip';
        const date = new Date(day + 'T12:00:00');
        chip.appendChild(recipientText('span', '', Number.isNaN(date.getTime()) ? day : date.toLocaleDateString('es-ES')));
        const remove = recipientText('button', '', '×');
        remove.type = 'button';
        remove.disabled = salaryLocked;
        remove.setAttribute('aria-label', 'Quitar día ' + day);
        remove.addEventListener('click', () => {
            if (salaryLocked) return;
            state.days = state.days.filter(value => value !== day);
            renderDays(state, container);
            syncSalarySelection();
        });
        chip.appendChild(remove);
        container.appendChild(chip);
    });
}
function buildSalaryRow(worker, initial) {
    const state = {
        id: worker.id,
        nombre: worker.nombre || worker.usuario || 'Trabajadora',
        selected: Boolean(initial),
        amount: initial ? String(initial.monto) : '',
        days: initial && Array.isArray(initial.dias) ? initial.dias.map(String).sort() : []
    };
    salaryRows.set(String(state.id), state);
    const row = document.createElement('article');
    row.className = 'salario-trabajadora-row';
    row.dataset.search = (state.nombre + ' ' + (worker.usuario || '')).toLowerCase();

    const identity = document.createElement('label');
    identity.className = 'salario-trabajadora-identidad';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = state.selected;
    check.disabled = salaryLocked;
    check.addEventListener('change', () => {
        state.selected = check.checked;
        row.classList.toggle('seleccionada', state.selected);
        syncSalarySelection();
    });
    identity.append(check, recipientText('span', 'salario-trabajadora-nombre', state.nombre));

    const amountLabel = document.createElement('label');
    amountLabel.className = 'salario-trabajadora-monto';
    amountLabel.appendChild(recipientText('span', '', 'Monto ($)'));
    const amount = document.createElement('input');
    amount.type = 'number';
    amount.min = '0.01';
    amount.step = '0.01';
    amount.inputMode = 'decimal';
    amount.placeholder = '0.00';
    amount.value = state.amount;
    amount.disabled = salaryLocked;
    amount.setAttribute('aria-label', 'Monto individual para ' + state.nombre);
    amount.addEventListener('input', () => {
        state.amount = amount.value;
        syncSalarySelection();
    });
    amountLabel.appendChild(amount);

    const daysSection = document.createElement('div');
    daysSection.className = 'salario-trabajadora-dias';
    daysSection.appendChild(recipientText('span', 'salario-dias-label', 'Días trabajados'));
    const controls = document.createElement('div');
    controls.className = 'salario-dias-controles';
    const date = document.createElement('input');
    date.type = 'date';
    date.disabled = salaryLocked;
    date.setAttribute('aria-label', 'Añadir día trabajado para ' + state.nombre);
    const add = recipientText('button', 'btn btn-secondary salario-dia-add', 'Añadir día');
    add.type = 'button';
    add.disabled = salaryLocked;
    const chips = document.createElement('div');
    chips.className = 'salario-dias-chips';
    add.addEventListener('click', () => {
        if (salaryLocked || !date.value) return;
        if (!state.days.includes(date.value)) state.days.push(date.value);
        state.days.sort();
        date.value = '';
        renderDays(state, chips);
        syncSalarySelection();
    });
    controls.append(date, add);
    renderDays(state, chips);
    daysSection.append(controls, chips);
    row.append(identity, amountLabel, daysSection);
    row.classList.toggle('seleccionada', state.selected);
    return row;
}
function renderSalaryRows(pendingPayload = null) {
    const list = document.getElementById('salario-trabajadoras-lista');
    if (!list) return;
    salaryRows = new Map();
    list.replaceChildren();
    const pending = new Map((pendingPayload || []).map(item => [String(item.usuario_id), item]));
    const known = new Set(salaryWorkers.map(worker => String(worker.id)));
    const workers = [...salaryWorkers];
    pending.forEach((_item, id) => {
        if (!known.has(id)) workers.push({ id, nombre: 'Cuenta no disponible', usuario: '' });
    });
    if (!workers.length) {
        list.appendChild(recipientText('p', 'salario-lista-vacia', 'No hay trabajadoras activas disponibles.'));
        syncSalarySelection();
        return;
    }
    workers.forEach(worker => list.appendChild(buildSalaryRow(worker, pending.get(String(worker.id)) || null)));
    syncSalarySelection();
    const search = document.getElementById('salario-buscar-trabajadora');
    if (search) search.value = '';
    aplicarFiltroTrabajadorasSalario();
}
export async function cargarDestinatariasSalario() {
    const list = document.getElementById('salario-trabajadoras-lista');
    if (!list) return;
    const pending = pendingSalary();
    salaryLocked = Boolean(pending);
    const warning = document.getElementById('salario-pago-pendiente');
    if (warning) warning.classList.toggle('hidden', !pending);
    const button = document.getElementById('salario-submit-btn');
    if (button) button.textContent = pending ? 'Reintentar el mismo pago' : 'Pagar salarios seleccionados';
    if (!salaryWorkers.length) {
        list.replaceChildren(recipientText('p', '', 'Cargando trabajadoras…'));
        try {
            const users = await window.obtenerTrabajadoras();
            salaryWorkers = (users || []).filter(worker => worker.estado === 'activo' && worker.id)
                .map(worker => ({ id: worker.id, nombre: worker.nombre, usuario: worker.usuario }));
        } catch (error) {
            console.error('[CuevaCoin] No se pudieron cargar destinatarias salariales:', error);
            list.replaceChildren(recipientText('p', 'salario-lista-vacia', 'No se pudieron cargar las trabajadoras. Comprueba la conexión.'));
            return;
        }
    }
    renderSalaryRows(pending ? pending.payload : null);
}
export function aplicarFiltroTrabajadorasSalario() {
    const query = (document.getElementById('salario-buscar-trabajadora')?.value || '').trim().toLowerCase();
    document.querySelectorAll('#salario-trabajadoras-lista .salario-trabajadora-row').forEach(row => {
        row.classList.toggle('hidden', Boolean(query) && !row.dataset.search.includes(query));
    });
}
export function seleccionarTodasTrabajadorasSalario() {
    if (salaryLocked) return;
    document.querySelectorAll('#salario-trabajadoras-lista .salario-trabajadora-row:not(.hidden) input[type="checkbox"]').forEach(input => {
        input.checked = true;
        input.dispatchEvent(new Event('change'));
    });
}
export function bloquearEdicionSalarioPendiente(blocked = true) {
    salaryLocked = blocked;
    const warning = document.getElementById('salario-pago-pendiente');
    if (warning) warning.classList.toggle('hidden', !blocked);
    const button = document.getElementById('salario-submit-btn');
    if (button) button.textContent = blocked ? 'Reintentar el mismo pago' : 'Pagar salarios seleccionados';
    void cargarDestinatariasSalario();
}
export function resetearFormularioSalario() {
    sessionStorage.removeItem('cuevacoin_salary_batch_pending');
    salaryLocked = false;
    salaryRows = new Map();
    window.seleccionDestinatariosSalario = [];
    document.getElementById('pagar-salario-form')?.reset();
    void cargarDestinatariasSalario();
}

// The older recipient selector is now used only for bonuses.
export async function abrirSelectorDestinatarios(contexto) {
    if (contexto === 'salario') { await cargarDestinatariasSalario(); return; }
    window.contextoSeleccionDestinatarios = contexto;
    const users = await window.obtenerTrabajadoras();
    const active = users.filter(user => user.estado === 'activo');
    const selected = window.seleccionDestinatariosBono || [];
    const ids = new Set(selected.map(user => user.id));
    const list = document.getElementById('selector-destinatarios-lista');
    if (!list) return;
    list.replaceChildren();
    if (!active.length) list.appendChild(recipientText('p', '', 'No hay trabajadoras activas.'));
    else {
        const fragment = document.createDocumentFragment();
        active.forEach(user => {
            const label = document.createElement('label');
            label.className = 'selector-destinatario-item';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = String(user.id || '');
            checkbox.dataset.nombre = String(user.nombre || user.usuario || 'Sin nombre');
            checkbox.checked = ids.has(user.id);
            label.append(checkbox, recipientText('span', '', checkbox.dataset.nombre + (user.correo ? ' · ' + String(user.correo) : '')));
            fragment.appendChild(label);
        });
        list.appendChild(fragment);
    }
    const search = document.getElementById('selector-destinatarios-buscar');
    if (search) search.value = '';
    const all = document.getElementById('selector-todos-checkbox');
    if (all) all.checked = active.length > 0 && ids.size === active.length;
    window.openModal('seleccionar-destinatarios-modal');
}
export function filtrarSelectorDestinatarios() {
    const query = (document.getElementById('selector-destinatarios-buscar')?.value || '').trim().toLowerCase();
    document.querySelectorAll('#selector-destinatarios-lista .selector-destinatario-item').forEach(item => {
        item.classList.toggle('hidden', Boolean(query) && !item.textContent.toLowerCase().includes(query));
    });
}
export function toggleTodosSelectorDestinatarios(input) {
    document.querySelectorAll('#selector-destinatarios-lista .selector-destinatario-item').forEach(item => {
        if (!item.classList.contains('hidden')) {
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (checkbox) checkbox.checked = input.checked;
        }
    });
}
export function actualizarResumenDestinatarios(contexto) {
    if (contexto === 'salario') { syncSalarySelection(); return; }
    const selected = window.seleccionDestinatariosBono || [];
    const summary = document.getElementById('bono-destinatarios-resumen');
    if (summary) summary.textContent = !selected.length ? 'Nadie seleccionado todavía'
        : selected.length <= 3 ? selected.map(user => String(user.nombre || '')).join(', ')
        : selected.length + ' trabajadoras seleccionadas';
}
export function confirmarSelectorDestinatarios() {
    window.seleccionDestinatariosBono = Array.from(document.querySelectorAll('#selector-destinatarios-lista input[type="checkbox"]:checked'))
        .map(input => ({ id: input.value, nombre: input.dataset.nombre }));
    actualizarResumenDestinatarios('bono');
    window.closeModal('seleccionar-destinatarios-modal');
}
if (typeof window !== 'undefined') {
    window.cargarDestinatariasSalario = cargarDestinatariasSalario;
    window.aplicarFiltroTrabajadorasSalario = aplicarFiltroTrabajadorasSalario;
    window.seleccionarTodasTrabajadorasSalario = seleccionarTodasTrabajadorasSalario;
    window.bloquearEdicionSalarioPendiente = bloquearEdicionSalarioPendiente;
    window.resetearFormularioSalario = resetearFormularioSalario;
    window.abrirSelectorDestinatarios = abrirSelectorDestinatarios;
    window.filtrarSelectorDestinatarios = filtrarSelectorDestinatarios;
    window.toggleTodosSelectorDestinatarios = toggleTodosSelectorDestinatarios;
    window.actualizarResumenDestinatarios = actualizarResumenDestinatarios;
    window.confirmarSelectorDestinatarios = confirmarSelectorDestinatarios;
}
