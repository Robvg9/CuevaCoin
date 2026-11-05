/** CuevaCoin — selección explícita de destinatarias y rangos de días para salarios. */
let salaryWorkers = [];
let salaryRows = new Map();
let salaryLocked = false;
let salaryPickerDraft = new Set();

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
function validDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
/** Retorna os días calendario inclusivos sin depender de la zona horaria local. */
export function buildInclusiveDays(desde, hasta) {
    if (!desde || !hasta) return [];
    if (!validDateOnly(desde) || !validDateOnly(hasta)) {
        throw new Error('Selecciona fechas válidas en Desde y Hasta.');
    }
    const start = Date.parse(desde + 'T00:00:00.000Z');
    const end = Date.parse(hasta + 'T00:00:00.000Z');
    if (end < start) throw new Error('La fecha Hasta no puede ser anterior a Desde.');
    const count = Math.floor((end - start) / 86400000) + 1;
    if (count > 31) throw new Error('El rango no puede superar 31 días trabajados por persona.');
    return Array.from({ length: count }, (_, index) =>
        new Date(start + index * 86400000).toISOString().slice(0, 10)
    );
}
function formatSalaryRange(days) {
    if (!Array.isArray(days) || !days.length) return 'Sin días seleccionados';
    const format = value => {
        const date = new Date(value + 'T12:00:00');
        return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-ES');
    };
    const contiguous = days.every((day, index) => index === 0 ||
        Date.parse(day + 'T00:00:00.000Z') - Date.parse(days[index - 1] + 'T00:00:00.000Z') === 86400000);
    if (!contiguous) return days.map(format).join(', ') + ' · ' + days.length + ' días';
    return days.length === 1
        ? format(days[0]) + ' · 1 día'
        : format(days[0]) + ' — ' + format(days[days.length - 1]) + ' · ' + days.length + ' días';
}
function syncSalarySelection() {
    const selected = [...salaryRows.values()].map(row => ({
        id: row.id, nombre: row.nombre, monto: row.amount, dias: [...row.days].sort()
    }));
    window.seleccionDestinatariosSalario = selected;
    const summary = document.getElementById('salario-destinatarios-resumen');
    if (summary) summary.textContent = selected.length
        ? selected.length + (selected.length === 1 ? ' trabajadora seleccionada' : ' trabajadoras seleccionadas')
        : 'Aún no has seleccionado trabajadoras.';
    const button = document.getElementById('salario-selector-open-btn');
    if (button && !salaryLocked) button.textContent = selected.length ? 'Cambiar selección' : 'Seleccionar';
}
function setSelectorVisible(visible) {
    const panel = document.getElementById('salario-selector-panel');
    const button = document.getElementById('salario-selector-open-btn');
    if (panel) panel.classList.toggle('hidden', !visible);
    if (button) button.setAttribute('aria-expanded', visible ? 'true' : 'false');
}
function renderSalaryPicker() {
    const list = document.getElementById('salario-selector-lista');
    if (!list) return;
    list.replaceChildren();
    if (!salaryWorkers.length) {
        list.appendChild(recipientText('p', 'salario-lista-vacia', 'No hay trabajadoras activas disponibles.'));
        return;
    }
    const fragment = document.createDocumentFragment();
    salaryWorkers.forEach(worker => {
        const id = String(worker.id);
        const label = document.createElement('label');
        label.className = 'salario-selector-item';
        label.dataset.search = (worker.nombre + ' ' + (worker.usuario || '')).toLowerCase();
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.value = id;
        check.checked = salaryPickerDraft.has(id);
        check.disabled = salaryLocked;
        check.addEventListener('change', () => {
            if (check.checked) salaryPickerDraft.add(id);
            else salaryPickerDraft.delete(id);
        });
        label.append(check, recipientText('span', '', worker.nombre || worker.usuario || 'Trabajadora'));
        fragment.appendChild(label);
    });
    list.appendChild(fragment);
    aplicarFiltroSelectorSalario();
}
function renderSalaryRows(pendingPayload = null) {
    const list = document.getElementById('salario-trabajadoras-lista');
    if (!list) return;
    list.replaceChildren();
    if (pendingPayload) {
        salaryRows = new Map();
        const known = new Map(salaryWorkers.map(worker => [String(worker.id), worker]));
        pendingPayload.forEach(item => {
            const id = String(item.usuario_id);
            const worker = known.get(id) || { id, nombre: 'Cuenta no disponible', usuario: '' };
            salaryRows.set(id, {
                id, nombre: worker.nombre || worker.usuario || 'Trabajadora',
                amount: String(item.monto), days: [...new Set((item.dias || []).map(String))].sort(),
                from: '', to: ''
            });
        });
    }
    if (!salaryRows.size) {
        list.appendChild(recipientText('p', 'salario-lista-vacia', 'Aún no has seleccionado trabajadoras.'));
        syncSalarySelection();
        return;
    }
    salaryRows.forEach(state => list.appendChild(buildSalaryRow(state)));
    syncSalarySelection();
}
function salaryMotive(days) {
    if (!Array.isArray(days) || !days.length) {
        return 'Selecciona Desde y Hasta para completar el motivo del salario.';
    }
    const format = value => {
        const date = new Date(value + 'T12:00:00');
        return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-ES', {
            day: 'numeric', month: 'long', year: 'numeric'
        });
    };
    return days.length === 1
        ? 'Salario por el día ' + format(days[0]) + '.'
        : 'Salario por los días del ' + format(days[0]) + ' al ' + format(days[days.length - 1]) + '.';
}
function buildSalaryRow(state) {
    const row = document.createElement('article');
    row.className = 'salario-trabajadora-row seleccionada';
    row.dataset.workerId = String(state.id);

    const identity = document.createElement('div');
    identity.className = 'salario-trabajadora-identidad';
    identity.appendChild(recipientText('strong', 'salario-trabajadora-nombre', state.nombre));
    if (!salaryLocked) {
        const remove = recipientText('button', 'salario-quitar-trabajadora', 'Quitar');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Quitar ' + state.nombre + ' de este pago');
        remove.addEventListener('click', () => {
            if (salaryLocked) return;
            salaryRows.delete(String(state.id));
            renderSalaryRows();
        });
        identity.appendChild(remove);
    }

    const amountLabel = document.createElement('label');
    amountLabel.className = 'salario-trabajadora-monto';
    amountLabel.appendChild(recipientText('span', 'salario-campo-label', 'Monto ($)'));
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

    const motiveSection = document.createElement('section');
    motiveSection.className = 'salario-trabajadora-dias salario-trabajadora-motivo';
    motiveSection.appendChild(recipientText('span', 'salario-campo-label', 'Motivo'));
    motiveSection.appendChild(recipientText('p', 'salario-motivo-ayuda', 'Selecciona en el calendario los días que trabajó esta persona.'));
    if (salaryLocked) {
        motiveSection.appendChild(recipientText('p', 'salario-rango-resumen', salaryMotive(state.days)));
    } else {
        const controls = document.createElement('div');
        controls.className = 'salario-rango-controles';
        const fromLabel = document.createElement('label');
        fromLabel.appendChild(recipientText('span', '', 'Desde'));
        const from = document.createElement('input');
        from.type = 'date';
        from.value = state.from || (state.days.length ? state.days[0] : '');
        from.setAttribute('aria-label', 'Desde para ' + state.nombre);
        fromLabel.appendChild(from);

        const toLabel = document.createElement('label');
        toLabel.appendChild(recipientText('span', '', 'Hasta'));
        const to = document.createElement('input');
        to.type = 'date';
        to.value = state.to || (state.days.length ? state.days[state.days.length - 1] : '');
        to.setAttribute('aria-label', 'Hasta para ' + state.nombre);
        toLabel.appendChild(to);

        const motivePreview = recipientText('p', 'salario-rango-resumen', salaryMotive(state.days));
        const updateRange = () => {
            const previous = { from: state.from, to: state.to, days: [...state.days] };
            try {
                const days = buildInclusiveDays(from.value, to.value);
                state.from = from.value;
                state.to = to.value;
                state.days = days;
                motivePreview.textContent = salaryMotive(days);
                syncSalarySelection();
            } catch (error) {
                from.value = previous.from || (previous.days[0] || '');
                to.value = previous.to || (previous.days.length ? previous.days[previous.days.length - 1] : '');
                window.showToast?.(error.message || 'Revisa el rango de fechas.', 4000);
            }
        };
        from.addEventListener('change', updateRange);
        to.addEventListener('change', updateRange);
        controls.append(fromLabel, toLabel);
        motiveSection.append(controls, motivePreview);
    }

    row.append(identity, amountLabel, motiveSection);
    return row;
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
    const selectorButton = document.getElementById('salario-selector-open-btn');
    if (selectorButton) selectorButton.disabled = salaryLocked;
    const panel = document.getElementById('salario-selector-panel');
    if (panel) panel.classList.toggle('hidden', salaryLocked);
    if (!salaryWorkers.length) {
        list.replaceChildren(recipientText('p', '', 'Cargando trabajadoras…'));
        try {
            const users = await window.obtenerTrabajadoras();
            salaryWorkers = (users || []).filter(worker => worker.estado === 'activo' && worker.id)
                .map(worker => ({ id: worker.id, nombre: worker.nombre || '', usuario: worker.usuario || '' }));
        } catch (error) {
            console.error('[CuevaCoin] No se pudieron cargar destinatarias salariales:', error);
            list.replaceChildren(recipientText('p', 'salario-lista-vacia', 'No se pudieron cargar las trabajadoras. Comprueba la conexión.'));
            return;
        }
    }
    renderSalaryRows(pending ? pending.payload : null);
    if (!salaryLocked) {
        salaryPickerDraft = new Set(salaryRows.keys());
        renderSalaryPicker();
    }
}
export function toggleSelectorSalario() {
    if (salaryLocked) return;
    const panel = document.getElementById('salario-selector-panel');
    const visible = Boolean(panel && panel.classList.contains('hidden'));
    if (visible) {
        salaryPickerDraft = new Set(salaryRows.keys());
        renderSalaryPicker();
    }
    setSelectorVisible(visible);
}
export function aplicarFiltroSelectorSalario() {
    const query = (document.getElementById('salario-selector-buscar')?.value || '').trim().toLowerCase();
    document.querySelectorAll('#salario-selector-lista .salario-selector-item').forEach(item => {
        item.classList.toggle('hidden', Boolean(query) && !item.dataset.search.includes(query));
    });
}
export function cancelarSelectorSalario() {
    salaryPickerDraft = new Set(salaryRows.keys());
    setSelectorVisible(false);
}
export function confirmarSeleccionSalario() {
    if (salaryLocked) return;
    const selected = new Set(salaryPickerDraft);
    [...salaryRows.keys()].forEach(id => { if (!selected.has(id)) salaryRows.delete(id); });
    salaryWorkers.forEach(worker => {
        const id = String(worker.id);
        if (selected.has(id) && !salaryRows.has(id)) {
            salaryRows.set(id, {
                id: worker.id, nombre: worker.nombre || worker.usuario || 'Trabajadora',
                amount: '', days: [], from: '', to: ''
            });
        }
    });
    setSelectorVisible(false);
    renderSalaryRows();
}
export function aplicarFiltroTrabajadorasSalario() {
    aplicarFiltroSelectorSalario();
}
export function seleccionarTodasTrabajadorasSalario() {
    if (salaryLocked) return;
    document.querySelectorAll('#salario-selector-lista .salario-selector-item:not(.hidden) input[type="checkbox"]').forEach(input => {
        input.checked = true;
        salaryPickerDraft.add(String(input.value));
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
    salaryPickerDraft = new Set();
    window.seleccionDestinatariosSalario = [];
    document.getElementById('pagar-salario-form')?.reset();
    setSelectorVisible(false);
    renderSalaryRows();
    syncSalarySelection();
}
export async function abrirSelectorDestinatarios(contexto) {
    if (contexto === 'salario') { toggleSelectorSalario(); return; }
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
    window.toggleSelectorSalario = toggleSelectorSalario;
    window.aplicarFiltroSelectorSalario = aplicarFiltroSelectorSalario;
    window.cancelarSelectorSalario = cancelarSelectorSalario;
    window.confirmarSeleccionSalario = confirmarSeleccionSalario;
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
