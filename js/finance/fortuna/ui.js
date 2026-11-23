/**
 * FORTUNA v1 — owner-scoped contacts and obligations UI.
 * All persisted data flows through the authenticated Edge dispatcher.
 * The browser never accesses private tables or calculates ledger balances.
 */
import {
  formatMinorAmount,
  parseMoneyToMinor,
  normalizeContactDraft,
  validateObligationDraft,
} from './preview-domain.mjs';
import {
  createContact,
  createIdempotencyKey,
  listContacts,
  listObligations,
  openObligation,
  previewSettlement,
  receiveCash,
  payContact,
  FortunaApiError,
} from './api.mjs';

function inicializarFortuna() {
  const root = document.getElementById('shared-fortuna');
  if (!root || root.dataset.fortunaReady === 'true') return;
  root.dataset.fortunaReady = 'true';

  const state = {
    contacts: [],
    selectedContactId: null,
    selectedObligations: [],
    loadingContacts: false,
    loadingObligations: false,
    sessionEpoch: 0,
    obligationRequest: 0,
    pendingContact: null,
    pendingObligation: null,
    settlementDraft: null,
    settlementPreviewRequest: 0,
  };
  const byId = (id) => root.querySelector('#' + id);
  const contactDialog = byId('fortuna-contact-dialog');
  const obligationDialog = byId('fortuna-obligation-dialog');
  const contactForm = byId('fortuna-contact-form');
  const obligationForm = byId('fortuna-obligation-form');
  const list = byId('fortuna-contact-list');
  const detail = byId('fortuna-contact-detail');
  const history = byId('fortuna-preview-history-list');
  const search = byId('fortuna-contact-search');
  const currencyFilter = byId('fortuna-contact-currency-filter');
  const status = byId('fortuna-session-status');

  if (![contactDialog, obligationDialog, contactForm, obligationForm, list, detail, history, search, currencyFilter, status].every(Boolean)) {
    console.error('[FORTUNA] Markup incompleto; no se inicializó la interfaz.');
    return;
  }

  const el = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };
  const setStatus = (message) => { status.textContent = message; };
  const selected = () => state.contacts.find((item) => item.contact_id === state.selectedContactId) ?? null;
  const closeDialog = (dialog) => { if (dialog.open) dialog.close(); };
  const openDialog = (dialog, focusId) => {
    if (typeof dialog.showModal !== 'function') {
      setStatus('Este navegador no admite diálogos accesibles. Actualízalo para continuar.');
      return;
    }
    dialog.showModal();
    byId(focusId)?.focus();
  };
  const safeMinor = (value) => {
    const text = String(value ?? '0');
    return /^[0-9]+$/.test(text) ? BigInt(text) : 0n;
  };
  const formatTotal = (minor) => {
    const value = BigInt(minor);
    const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return whole + ',' + (value % 100n).toString().padStart(2, '0');
  };
  const activateTab = (key) => {
    const tab = root.querySelector('[data-fortuna-tab="' + key + '"]');
    const panel = root.querySelector('[data-fortuna-panel="' + key + '"]');
    if (!tab || !panel) return;
    root.querySelectorAll('[data-fortuna-tab]').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
      item.tabIndex = active ? 0 : -1;
    });
    root.querySelectorAll('[data-fortuna-panel]').forEach((item) => { item.hidden = item !== panel; });
  };

  function contactCurrencies(contact) {
    return Array.isArray(contact?.currencies) ? contact.currencies : [];
  }

  function renderBalance(container, summary) {
    const line = el('div', 'fortuna-contact-position');
    const receivable = el('div');
    receivable.append(el('span', '', 'Te debe'));
    receivable.append(el('strong', '', formatMinorAmount(String(safeMinor(summary.te_debe_minor))) + ' ' + summary.currency));
    const payable = el('div');
    payable.append(el('span', '', 'Le debes'));
    payable.append(el('strong', '', formatMinorAmount(String(safeMinor(summary.le_debes_minor))) + ' ' + summary.currency));
    line.append(receivable, payable);
    container.append(line);
  }

  function getFilteredContacts() {
    const term = search.value.trim().toLocaleLowerCase();
    const currency = currencyFilter.value;
    return state.contacts
      .filter((contact) => {
        const matchesText = !term || (String(contact.display_name ?? '') + ' ' + String(contact.phone ?? '')).toLocaleLowerCase().includes(term);
        const matchesCurrency = !currency || contactCurrencies(contact).some((item) => item.currency === currency);
        return matchesText && matchesCurrency;
      })
      .slice();
  }

  function renderContacts() {
    list.replaceChildren();
    const contacts = getFilteredContacts();
    byId('fortuna-draft-contact-count').textContent =
      state.contacts.length + (state.contacts.length === 1 ? ' contacto' : ' contactos');

    if (state.loadingContacts && !state.contacts.length) {
      list.append(el('div', 'fortuna-empty-state', 'Consultando tu libro…'));
      return;
    }
    if (!contacts.length) {
      const empty = el('div', 'fortuna-empty-state');
      empty.append(el('span', '', '👤'));
      empty.append(el('h3', '', state.contacts.length ? 'No hay coincidencias' : 'Todavía no tienes contactos'));
      empty.append(el('p', '', state.contacts.length
        ? 'Cambia el texto o el filtro de moneda.'
        : 'Crea un contacto para registrar a quién le debes o quién te debe.'));
      list.append(empty);
      return;
    }

    for (const contact of contacts) {
      const card = el('article', 'fortuna-contact-card');
      const heading = el('div', 'fortuna-contact-card-head');
      heading.append(el('h3', '', contact.display_name || 'Contacto'));
      card.append(heading);
      if (contact.phone) card.append(el('small', '', contact.phone));

      const summaries = contactCurrencies(contact);
      if (summaries.length) summaries.forEach((summary) => renderBalance(card, summary));
      else card.append(el('small', '', 'Sin obligaciones abiertas'));

      const open = el('button', 'btn btn-secondary', 'Abrir ficha');
      open.type = 'button';
      open.dataset.openContact = contact.contact_id;
      card.append(open);
      list.append(card);
    }
  }

  function ensureSettlementDraft(contact) {
    if (state.settlementDraft?.contactId === contact.contact_id) return state.settlementDraft;
    const firstCurrency = contactCurrencies(contact).find((item) => ['CUP', 'USD', 'EUR'].includes(item.currency))?.currency;
    state.settlementDraft = {
      contactId: contact.contact_id,
      currency: firstCurrency || 'CUP',
      flow: 'cash_received',
      mode: 'fifo',
      amount: '',
      manualAllocations: Object.create(null),
      preview: null,
      previewKey: null,
      previewLoading: false,
      overageConfirmed: false,
      pendingCommit: null,
      commitBusy: false,
    };
    return state.settlementDraft;
  }

  function eligibleSettlementObligations(draft) {
    const direction = draft.flow === 'cash_received' ? 'receivable' : 'payable';
    return state.selectedObligations.filter((item) =>
      item.currency === draft.currency && item.direction === direction);
  }

  function renderManualSettlementAllocations(container, draft, locked) {
    container.replaceChildren();
    const obligations = eligibleSettlementObligations(draft);
    if (!obligations.length) {
      container.append(el('p', 'fortuna-empty-state', 'No hay obligaciones abiertas de esta moneda y dirección. Si continúas, todo el importe quedará como exceso y requerirá confirmación expresa.'));
      return;
    }
    for (const obligation of obligations) {
      const field = el('label', 'fortuna-form-field');
      field.append(el('span', '', obligation.description + ' · Pendiente: '
        + formatMinorAmount(obligation.remaining_minor) + ' ' + obligation.currency));
      const input = el('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.maxLength = 24;
      input.autocomplete = 'off';
      input.placeholder = 'Importe a asignar';
      input.value = draft.manualAllocations[obligation.obligation_id] || '';
      input.dataset.settlementAllocation = obligation.obligation_id;
      input.disabled = locked;
      field.append(input);
      container.append(field);
    }
  }

  function settlementPayload(draft) {
    const totalAmountMinor = parseMoneyToMinor(draft.amount);
    const requestedAllocations = draft.mode === 'manual'
      ? eligibleSettlementObligations(draft)
        .map((obligation) => {
          const raw = String(draft.manualAllocations[obligation.obligation_id] || '').trim();
          return raw ? {
            obligation_id: obligation.obligation_id,
            amount_minor: parseMoneyToMinor(raw),
          } : null;
        })
        .filter(Boolean)
        .sort((left, right) => left.obligation_id.localeCompare(right.obligation_id))
      : [];
    return {
      contactId: draft.contactId,
      currency: draft.currency,
      flow: draft.flow,
      mode: draft.mode,
      totalAmountMinor,
      requestedAllocations,
    };
  }

  function renderSettlementWorkbench(contact) {
    const draft = ensureSettlementDraft(contact);
    const locked = draft.commitBusy || Boolean(draft.pendingCommit);
    const panel = el('section', 'fortuna-settlement-workbench');
    panel.append(el('h4', '', 'Registrar liquidación'));
    panel.append(el('p', 'fortuna-dialog-note', 'Primero se consulta al servidor cómo se aplicaría el dinero. No se registra nada hasta que confirmes por separado.'));

    const fields = el('div', 'fortuna-contact-position');
    const flowField = el('label', 'fortuna-form-field');
    flowField.append(el('span', '', 'Movimiento'));
    const flow = el('select');
    flow.dataset.settlementField = 'flow';
    flow.disabled = locked;
    for (const [value, label] of [['cash_received', 'Recibí dinero de esta persona'], ['cash_paid', 'Le pagué dinero a esta persona']]) {
      const option = el('option', '', label);
      option.value = value;
      flow.append(option);
    }
    flow.value = draft.flow;
    flowField.append(flow);

    const currencyField = el('label', 'fortuna-form-field');
    currencyField.append(el('span', '', 'Moneda'));
    const currency = el('select');
    currency.dataset.settlementField = 'currency';
    currency.disabled = locked;
    for (const code of ['CUP', 'USD', 'EUR']) {
      const option = el('option', '', code);
      option.value = code;
      currency.append(option);
    }
    currency.value = draft.currency;
    currencyField.append(currency);

    const modeField = el('label', 'fortuna-form-field');
    modeField.append(el('span', '', 'Forma de asignar'));
    const mode = el('select');
    mode.dataset.settlementField = 'mode';
    mode.disabled = locked;
    for (const [value, label] of [['fifo', 'Automática · más antigua primero (FIFO)'], ['manual', 'Manual · elegir obligaciones']]) {
      const option = el('option', '', label);
      option.value = value;
      mode.append(option);
    }
    mode.value = draft.mode;
    modeField.append(mode);

    const amountField = el('label', 'fortuna-form-field');
    amountField.append(el('span', '', 'Importe recibido o pagado'));
    const amount = el('input');
    amount.type = 'text';
    amount.inputMode = 'decimal';
    amount.maxLength = 24;
    amount.autocomplete = 'off';
    amount.placeholder = 'Ej. 1250,50';
    amount.value = draft.amount;
    amount.dataset.settlementField = 'amount';
    amount.disabled = locked;
    amountField.append(amount);
    fields.append(flowField, currencyField, modeField, amountField);
    panel.append(fields);

    const manualList = el('div', 'fortuna-obligation-list');
    manualList.dataset.settlementManualList = 'true';
    manualList.hidden = draft.mode !== 'manual';
    renderManualSettlementAllocations(manualList, draft, locked);
    panel.append(manualList);

    const actions = el('div', 'fortuna-dialog-actions');
    const previewButton = el('button', 'btn btn-secondary',
      draft.previewLoading ? 'Calculando distribución…' : 'Previsualizar distribución');
    previewButton.type = 'button';
    previewButton.dataset.settlementPreview = 'true';
    previewButton.disabled = locked || draft.previewLoading;
    actions.append(previewButton);
    panel.append(actions);

    const result = el('section', 'fortuna-detail-totals');
    result.dataset.settlementPreviewResult = 'true';
    result.setAttribute('aria-live', 'polite');
    if (!draft.preview) {
      result.append(el('p', '', 'La vista previa aparecerá aquí. Los cambios en contacto, moneda, dirección, modo, importe o asignaciones la invalidan.'));
    } else {
      const preview = draft.preview;
      const summary = el('div', 'fortuna-detail-total');
      summary.append(el('strong', '', 'Importe: ' + formatMinorAmount(preview.total_amount_minor) + ' ' + preview.currency));
      summary.append(el('span', '', 'Asignado a obligaciones: ' + formatMinorAmount(preview.allocated_minor) + ' ' + preview.currency));
      summary.append(el('span', '', 'Exceso: ' + formatMinorAmount(preview.overage_minor) + ' ' + preview.currency));
      result.append(summary);
      result.append(el('small', '', preview.flow === 'cash_received' ? 'Dirección: dinero recibido' : 'Dirección: dinero pagado'));
      result.append(el('h5', '', 'Asignaciones calculadas por el servidor'));
      if (preview.allocations.length) {
        const rows = el('div', 'fortuna-obligation-list');
        for (const allocation of preview.allocations) {
          const obligation = state.selectedObligations.find((item) => item.obligation_id === allocation.obligation_id);
          const row = el('article', 'fortuna-obligation-row');
          row.append(el('strong', '', obligation?.description || ('Obligación ' + allocation.obligation_id.slice(0, 8))));
          row.append(el('span', '', formatMinorAmount(allocation.amount_minor) + ' ' + preview.currency));
          rows.append(row);
        }
        result.append(rows);
      } else {
        result.append(el('p', '', 'No se asignará dinero a obligaciones existentes.'));
      }
      if (BigInt(preview.overage_minor) > 0n) {
        const overageDirection = preview.overage_direction === 'payable'
          ? 'quedará como una nueva obligación que tú le debes a esta persona'
          : 'quedará como una nueva obligación que esta persona te debe';
        result.append(el('p', 'fortuna-server-note', 'Exceso: ' + overageDirection + '.'));
        const confirmation = el('label', 'fortuna-server-note fortuna-settlement-confirmation');
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = draft.overageConfirmed;
        checkbox.dataset.settlementOverageConfirm = 'true';
        checkbox.disabled = locked;
        checkbox.style.width = 'auto';
        checkbox.style.minHeight = 'auto';
        confirmation.append(checkbox, el('span', '', 'Confirmo expresamente la creación de esa obligación por el exceso de '
          + formatMinorAmount(preview.overage_minor) + ' ' + preview.currency + '.'));
        result.append(confirmation);
      }
      result.append(el('small', '', 'Vista previa verificada por el servidor. Identificador de revisión: ' + preview.preview_fingerprint.slice(0, 12) + '…'));
    }
    panel.append(result);

    const commitActions = el('div', 'fortuna-dialog-actions');
    const overage = draft.preview ? BigInt(draft.preview.overage_minor) : 0n;
    const canCommit = Boolean(draft.preview && !draft.previewLoading && !draft.commitBusy
      && (!draft.pendingCommit ? (overage === 0n || draft.overageConfirmed) : true));
    const commitButton = el('button', 'btn btn-primary',
      draft.pendingCommit?.uncertain ? 'Reintentar la misma confirmación' : 'Confirmar liquidación');
    commitButton.type = 'button';
    commitButton.dataset.settlementCommit = 'true';
    commitButton.disabled = locked ? !draft.pendingCommit?.uncertain : !canCommit;
    commitActions.append(commitButton);
    panel.append(commitActions);
    if (locked) {
      panel.append(el('p', 'fortuna-server-note', draft.pendingCommit?.uncertain
        ? 'Respuesta incierta: se conserva exactamente el mismo importe, reparto, fingerprint y clave idempotente. No cambies de contacto ni abras otra liquidación; reintenta esta confirmación.'
        : 'Confirmación en curso. No cierres ni cambies los datos.'));
    }
    return panel;
  }

  function invalidateSettlementPreview(draft) {
    if (!draft || draft.pendingCommit) return;
    state.settlementPreviewRequest += 1;
    draft.preview = null;
    draft.previewKey = null;
    draft.previewLoading = false;
    draft.overageConfirmed = false;
    const result = detail.querySelector('[data-settlement-preview-result]');
    if (result) {
      result.replaceChildren(el('p', '', 'La vista previa quedó invalidada por un cambio. Genera y revisa un plan nuevo antes de confirmar.'));
    }
    const confirmation = detail.querySelector('[data-settlement-overage-confirm]');
    if (confirmation) confirmation.checked = false;
    const commit = detail.querySelector('[data-settlement-commit]');
    if (commit) commit.disabled = true;
  }

  async function previewSettlementDraft() {
    const draft = state.settlementDraft;
    if (!draft || draft.pendingCommit || draft.previewLoading) return;
    let payload;
    try {
      payload = settlementPayload(draft);
    } catch (error) {
      setStatus(errorMessage(error));
      return;
    }
    const request = ++state.settlementPreviewRequest;
    const epoch = state.sessionEpoch;
    const payloadKey = JSON.stringify(payload);
    draft.preview = null;
    draft.previewKey = null;
    draft.overageConfirmed = false;
    draft.previewLoading = true;
    renderContactDetail();
    try {
      const plan = await previewSettlement(payload);
      if (epoch !== state.sessionEpoch || request !== state.settlementPreviewRequest
        || state.settlementDraft !== draft || draft.contactId !== state.selectedContactId
        || JSON.stringify(settlementPayload(draft)) !== payloadKey) return;
      draft.preview = plan;
      draft.previewKey = payloadKey;
      setStatus('Vista previa calculada por el servidor. Revisa las asignaciones y el posible exceso.');
    } catch (error) {
      if (epoch !== state.sessionEpoch || request !== state.settlementPreviewRequest || state.settlementDraft !== draft) return;
      setStatus(errorMessage(error));
    } finally {
      if (epoch === state.sessionEpoch && request === state.settlementPreviewRequest && state.settlementDraft === draft) {
        draft.previewLoading = false;
        renderContactDetail();
      }
    }
  }

  async function confirmSettlementDraft() {
    const draft = state.settlementDraft;
    if (!draft || draft.commitBusy) return;
    let pending = draft.pendingCommit;
    if (!pending) {
      let payload;
      try {
        payload = settlementPayload(draft);
      } catch (error) {
        setStatus(errorMessage(error));
        return;
      }
      if (!draft.preview || draft.previewKey !== JSON.stringify(payload)) {
        setStatus('La vista previa no corresponde a los datos actuales. Calcula y revisa un plan nuevo.');
        invalidateSettlementPreview(draft);
        renderContactDetail();
        return;
      }
      const overage = BigInt(draft.preview.overage_minor);
      if (overage > 0n && !draft.overageConfirmed) {
        setStatus('Debes confirmar expresamente la obligación que se creará por el exceso.');
        return;
      }
      pending = {
        payload,
        previewFingerprint: draft.preview.preview_fingerprint,
        confirmOverage: overage > 0n && draft.overageConfirmed,
        idempotencyKey: createIdempotencyKey(),
        uncertain: false,
      };
      draft.pendingCommit = pending;
    }

    const epoch = state.sessionEpoch;
    draft.commitBusy = true;
    renderContactDetail();
    try {
      const commitArgs = {
        ...pending.payload,
        previewFingerprint: pending.previewFingerprint,
        confirmOverage: pending.confirmOverage,
        idempotencyKey: pending.idempotencyKey,
      };
      if (pending.payload.flow === 'cash_received') await receiveCash(commitArgs);
      else await payContact(commitArgs);
      draft.pendingCommit = null;
      draft.preview = null;
      state.settlementDraft = null;
      draft.commitBusy = false;
      const refreshed = await loadContacts({ preserveStatus: true });
      setStatus(refreshed
        ? 'Liquidación registrada. Saldos y obligaciones actualizados desde el servidor.'
        : 'Liquidación confirmada por el servidor. La actualización de la ficha falló; pulsa Actualizar.');
    } catch (error) {
      draft.commitBusy = false;
      const code = error?.code;
      if (code === 'STALE_PREVIEW') {
        draft.pendingCommit = null;
        draft.preview = null;
        draft.previewKey = null;
        draft.overageConfirmed = false;
        setStatus('El saldo cambió después de la vista previa. Se descartó el plan; consulta de nuevo y revisa la nueva distribución.');
        await loadSelectedObligations();
      } else if (code === 'IDEMPOTENCY_CONFLICT') {
        draft.pendingCommit = null;
        draft.preview = null;
        draft.previewKey = null;
        draft.overageConfirmed = false;
        setStatus('Esta clave ya está vinculada a otra operación. No se repetirá el envío; actualiza las obligaciones y genera una nueva vista previa antes de continuar.');
        await loadSelectedObligations();
      } else if (error?.retryable) {
        pending.uncertain = true;
        setStatus('No se pudo confirmar la respuesta. Reintenta esta misma confirmación: se reutilizarán exactamente los mismos datos, fingerprint y clave.');
      } else {
        draft.pendingCommit = null;
        draft.preview = null;
        draft.previewKey = null;
        draft.overageConfirmed = false;
        setStatus(errorMessage(error));
      }
    } finally {
      if (epoch === state.sessionEpoch && state.settlementDraft === draft) {
        draft.commitBusy = false;
        renderContactDetail();
      }
    }
  }

  function renderContactDetail() {
    const contact = selected();
    detail.replaceChildren();
    if (!contact) {
      detail.hidden = true;
      byId('fortuna-new-obligation-btn').disabled = true;
      return;
    }

    detail.hidden = false;
    const heading = el('div', 'fortuna-detail-head');
    const identity = el('div');
    identity.append(el('h3', '', contact.display_name));
    identity.append(el('p', '', [contact.phone, contact.notes].filter(Boolean).join(' · ') || 'Sin teléfono ni notas'));
    const close = el('button', 'btn btn-secondary', 'Cerrar ficha');
    close.type = 'button';
    close.dataset.closeContactDetail = 'true';
    heading.append(identity, close);
    detail.append(heading);

    const summaries = contactCurrencies(contact);
    if (summaries.length) {
      const totals = el('div', 'fortuna-detail-totals');
      for (const summary of summaries) {
        const item = el('div', 'fortuna-detail-total');
        const receivable = safeMinor(summary.te_debe_minor);
        const payable = safeMinor(summary.le_debes_minor);
        if (receivable > 0n && payable > 0n) item.append(el('small', '', 'Posición mixta en ' + summary.currency));
        item.append(el('strong', '', 'Te debe: ' + formatMinorAmount(String(receivable)) + ' ' + summary.currency));
        item.append(el('strong', '', 'Le debes: ' + formatMinorAmount(String(payable)) + ' ' + summary.currency));
        totals.append(item);
      }
      detail.append(totals);
    } else {
      detail.append(el('p', '', 'Este contacto no tiene obligaciones abiertas.'));
    }

    const add = el('button', 'btn btn-primary', '＋ Nueva obligación');
    add.type = 'button';
    add.dataset.addObligation = 'true';
    detail.append(add);

    if (state.loadingObligations) {
      detail.append(el('p', '', 'Consultando obligaciones abiertas…'));
    } else if (state.selectedObligations.length) {
      detail.append(el('h4', '', 'Obligaciones abiertas'));
      const rows = el('div', 'fortuna-obligation-list');
      for (const obligation of state.selectedObligations) {
        const row = el('article', 'fortuna-obligation-row');
        const copy = el('div');
        copy.append(el('strong', '', obligation.description));
        copy.append(el('p', '', (obligation.direction === 'receivable' ? 'Te deben' : 'Tú debes')
          + ' · ' + obligation.currency
          + (obligation.due_at ? ' · Vence ' + new Date(obligation.due_at).toLocaleDateString() : '')));
        row.append(copy, el('span', '', formatMinorAmount(obligation.remaining_minor) + ' ' + obligation.currency));
        rows.append(row);
      }
      detail.append(rows);
    } else {
      detail.append(el('p', '', 'No hay obligaciones pendientes para este contacto.'));
    }
    detail.append(renderSettlementWorkbench(contact));
    byId('fortuna-new-obligation-btn').disabled = false;
  }

  function renderHistory() {
    history.replaceChildren();
    const contact = selected();
    if (!contact) {
      const empty = el('div', 'fortuna-empty-state');
      empty.append(el('span', '', '📚'));
      empty.append(el('h3', '', 'Selecciona un contacto'));
      empty.append(el('p', '', 'Esta vista muestra obligaciones abiertas del contacto seleccionado, no movimientos cerrados.'));
      history.append(empty);
      return;
    }
    if (!state.selectedObligations.length) {
      const empty = el('div', 'fortuna-empty-state');
      empty.append(el('span', '', '📚'));
      empty.append(el('h3', '', 'Sin obligaciones abiertas'));
      empty.append(el('p', '', contact.display_name + ' no tiene obligaciones pendientes.'));
      history.append(empty);
      return;
    }
    for (const obligation of state.selectedObligations) {
      const row = el('article', 'fortuna-preview-history-row');
      const copy = el('div');
      copy.append(el('strong', '', obligation.description));
      copy.append(el('small', '', contact.display_name + ' · '
        + (obligation.direction === 'receivable' ? 'Te deben' : 'Tú debes') + ' · Abierta'));
      row.append(copy, el('span', '', formatMinorAmount(obligation.remaining_minor) + ' ' + obligation.currency));
      history.append(row);
    }
  }

  function renderSummary() {
    const totals = new Map();
    for (const contact of state.contacts) {
      for (const item of contactCurrencies(contact)) {
        const current = totals.get(item.currency) ?? { receivable: 0n, payable: 0n };
        current.receivable += safeMinor(item.te_debe_minor);
        current.payable += safeMinor(item.le_debes_minor);
        totals.set(item.currency, current);
      }
    }
    const summaryText = (key) => [...totals.entries()]
      .filter(([, amounts]) => amounts[key] > 0n)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amounts]) => formatTotal(amounts[key]) + ' ' + currency)
      .join(' · ') || '0,00';
    const cards = root.querySelectorAll('.fortuna-summary-card');
    if (cards[0]) {
      cards[0].querySelector('strong').textContent = state.loadingContacts ? '…' : summaryText('receivable');
      cards[0].querySelector('small').textContent = 'Saldos abiertos en tu libro';
    }
    if (cards[1]) {
      cards[1].querySelector('strong').textContent = state.loadingContacts ? '…' : summaryText('payable');
      cards[1].querySelector('small').textContent = 'Saldos abiertos en tu libro';
    }
    if (cards[2]) {
      cards[2].querySelector('strong').textContent = state.loadingContacts ? '…' : String(state.contacts.length);
      cards[2].querySelector('small').textContent = 'Contactos guardados';
    }
    renderContacts();
    renderContactDetail();
    renderHistory();
  }

  function errorMessage(error) {
    if (error instanceof FortunaApiError) return error.message;
    return 'No se pudo completar la operación. Vuelve a intentarlo.';
  }

  async function loadContacts({ preserveStatus = false } = {}) {
    const epoch = state.sessionEpoch;
    state.loadingContacts = true;
    renderSummary();
    try {
      const records = await listContacts();
      if (epoch !== state.sessionEpoch) return false;
      state.contacts = records;
      if (state.selectedContactId && !state.contacts.some((item) => item.contact_id === state.selectedContactId)) {
        state.selectedContactId = null;
        state.selectedObligations = [];
      }
      state.loadingContacts = false;
      renderSummary();
      if (state.selectedContactId) await loadSelectedObligations();
      if (!preserveStatus) setStatus(state.contacts.length
        ? 'Libro actualizado desde el servidor.'
        : 'Tu libro está vacío. Crea tu primer contacto.');
      return true;
    } catch (error) {
      if (epoch !== state.sessionEpoch) return false;
      state.contacts = [];
      state.selectedContactId = null;
      state.selectedObligations = [];
      state.loadingContacts = false;
      renderSummary();
      setStatus(errorMessage(error));
      return false;
    }
  }

  async function loadSelectedObligations() {
    const contact = selected();
    if (!contact) return false;
    const epoch = state.sessionEpoch;
    const request = ++state.obligationRequest;
    const contactId = contact.contact_id;
    if (state.settlementDraft?.contactId === contactId && !state.settlementDraft.pendingCommit) {
      invalidateSettlementPreview(state.settlementDraft);
    }
    state.loadingObligations = true;
    renderContactDetail();
    try {
      const records = await listObligations(contactId);
      if (epoch !== state.sessionEpoch || request !== state.obligationRequest || state.selectedContactId !== contactId) return false;
      state.selectedObligations = Array.isArray(records) ? records : [];
      state.loadingObligations = false;
      renderContactDetail();
      renderHistory();
      return true;
    } catch (error) {
      if (epoch !== state.sessionEpoch || request !== state.obligationRequest) return false;
      state.selectedObligations = [];
      state.loadingObligations = false;
      renderContactDetail();
      setStatus(errorMessage(error));
      return false;
    }
  }

  function lockFormFields(form, locked) {
    form.querySelectorAll('input, textarea, select').forEach((field) => {
      field.readOnly = locked && (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA');
      field.disabled = locked && field.tagName === 'SELECT';
    });
  }

  function openNewContact() {
    if (state.pendingContact?.uncertain) {
      byId('fortuna-contact-name').value = state.pendingContact.payload.displayName;
      byId('fortuna-contact-phone').value = state.pendingContact.payload.phone;
      byId('fortuna-contact-notes').value = state.pendingContact.payload.notes;
      lockFormFields(contactForm, true);
      byId('fortuna-contact-form-error').textContent = 'Reintenta exactamente este envío para conservar su clave idempotente.';
    } else {
      state.pendingContact = null;
      contactForm.reset();
      lockFormFields(contactForm, false);
      byId('fortuna-contact-form-error').textContent = '';
    }
    openDialog(contactDialog, 'fortuna-contact-name');
  }

  function openNewObligation() {
    const contact = selected();
    if (!contact) {
      setStatus('Primero abre la ficha de un contacto.');
      return;
    }
    if (state.pendingObligation?.uncertain && state.pendingObligation.payload.contactId !== contact.contact_id) {
      setStatus('Hay un envío sin resultado confirmado. Vuelve a la ficha original y reintenta allí antes de iniciar otra obligación.');
      return;
    }
    if (state.pendingObligation?.uncertain && state.pendingObligation.payload.contactId === contact.contact_id) {
      const pending = state.pendingObligation.payload;
      byId('fortuna-obligation-direction').value = pending.direction;
      byId('fortuna-obligation-currency').value = pending.currency;
      byId('fortuna-obligation-amount').value = formatMinorAmount(pending.amountMinor);
      byId('fortuna-obligation-description').value = pending.description;
      lockFormFields(obligationForm, true);
      byId('fortuna-obligation-form-error').textContent = 'Reintenta exactamente este envío para conservar su clave idempotente.';
    } else {
      state.pendingObligation = null;
      obligationForm.reset();
      lockFormFields(obligationForm, false);
      byId('fortuna-obligation-form-error').textContent = '';
    }
    byId('fortuna-obligation-contact').textContent = 'Contacto: ' + contact.display_name;
    openDialog(obligationDialog, 'fortuna-obligation-amount');
  }

  byId('fortuna-new-contact-btn').addEventListener('click', openNewContact);
  byId('fortuna-new-obligation-btn').addEventListener('click', openNewObligation);
  byId('fortuna-refresh-btn')?.addEventListener('click', () => { void loadContacts(); });

  root.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => closeDialog(byId(button.dataset.closeDialog)));
  });
  root.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });

  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = byId('fortuna-contact-form-error');
    const submit = contactForm.querySelector('button[type="submit"]');
    error.textContent = '';
    try {
      const normalized = normalizeContactDraft({
        name: byId('fortuna-contact-name').value,
        phone: byId('fortuna-contact-phone').value,
        notes: byId('fortuna-contact-notes').value,
      });
      const fingerprint = JSON.stringify(normalized);
      if (!state.pendingContact || state.pendingContact.fingerprint !== fingerprint) {
        state.pendingContact = {
          fingerprint,
          idempotencyKey: createIdempotencyKey(),
          payload: normalized,
        };
      }
      submit.disabled = true;
      contactDialog.querySelectorAll('[data-close-dialog]').forEach((button) => { button.disabled = true; });
      lockFormFields(contactForm, false);
      contactForm.querySelectorAll('input, textarea').forEach((field) => { field.disabled = true; });
      submit.textContent = 'Guardando…';
      const response = await createContact({
        ...state.pendingContact.payload,
        idempotencyKey: state.pendingContact.idempotencyKey,
      });
      state.pendingContact = null;
      closeDialog(contactDialog);
      if (response?.contact_id) {
        state.selectedContactId = response.contact_id;
        state.selectedObligations = [];
      }
      const loaded = await loadContacts({ preserveStatus: true });
      if (response?.contact_id) activateTab('contacts');
      setStatus(loaded ? 'Contacto guardado en tu libro.' : 'Contacto guardado. No se pudo actualizar la lista; usa Actualizar.');
    } catch (validationOrApiError) {
      error.textContent = errorMessage(validationOrApiError);
      if (validationOrApiError?.retryable && state.pendingContact) {
        state.pendingContact.uncertain = true;
        byId('fortuna-contact-name').value = state.pendingContact.payload.displayName;
        byId('fortuna-contact-phone').value = state.pendingContact.payload.phone;
        byId('fortuna-contact-notes').value = state.pendingContact.payload.notes;
        lockFormFields(contactForm, true);
        error.textContent += ' Reintenta sin cambiar los datos.';
      } else {
        state.pendingContact = null;
        lockFormFields(contactForm, false);
      }
    } finally {
      submit.disabled = false;
      contactDialog.querySelectorAll('[data-close-dialog]').forEach((button) => { button.disabled = false; });
      contactForm.querySelectorAll('input, textarea').forEach((field) => { field.disabled = false; });
      submit.textContent = state.pendingContact?.uncertain ? 'Reintentar mismo envío' : 'Guardar contacto';
    }
  });

  obligationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = byId('fortuna-obligation-form-error');
    const submit = obligationForm.querySelector('button[type="submit"]');
    error.textContent = '';
    const contact = selected();
    if (!contact) {
      error.textContent = 'La ficha de contacto ya no está disponible. Cierra el formulario y vuelve a seleccionarla.';
      return;
    }
    try {
      const validated = validateObligationDraft({
        direction: byId('fortuna-obligation-direction').value,
        currency: byId('fortuna-obligation-currency').value,
        amount: byId('fortuna-obligation-amount').value,
        description: byId('fortuna-obligation-description').value,
      });
      const payload = {
        contactId: contact.contact_id,
        direction: validated.direction,
        currency: validated.currency,
        amountMinor: validated.amountMinor,
        description: validated.description,
        dueAt: null,
      };
      const fingerprint = JSON.stringify(payload);
      if (!state.pendingObligation || state.pendingObligation.fingerprint !== fingerprint) {
        state.pendingObligation = {
          fingerprint,
          idempotencyKey: createIdempotencyKey(),
          payload,
        };
      }
      submit.disabled = true;
      obligationDialog.querySelectorAll('[data-close-dialog]').forEach((button) => { button.disabled = true; });
      obligationForm.querySelectorAll('input, textarea, select').forEach((field) => { field.disabled = true; });
      submit.textContent = 'Guardando…';
      await openObligation({
        ...state.pendingObligation.payload,
        idempotencyKey: state.pendingObligation.idempotencyKey,
      });
      state.pendingObligation = null;
      closeDialog(obligationDialog);
      await loadContacts({ preserveStatus: true });
      setStatus('Obligación guardada en el libro y registrada contablemente.');
    } catch (validationOrApiError) {
      error.textContent = errorMessage(validationOrApiError);
      if (validationOrApiError?.retryable && state.pendingObligation) {
        state.pendingObligation.uncertain = true;
        lockFormFields(obligationForm, true);
        const pending = state.pendingObligation.payload;
        byId('fortuna-obligation-direction').value = pending.direction;
        byId('fortuna-obligation-currency').value = pending.currency;
        byId('fortuna-obligation-amount').value = formatMinorAmount(pending.amountMinor);
        byId('fortuna-obligation-description').value = pending.description;
        error.textContent += ' Reintenta sin cambiar los datos.';
      } else {
        state.pendingObligation = null;
        lockFormFields(obligationForm, false);
      }
    } finally {
      submit.disabled = false;
      obligationDialog.querySelectorAll('[data-close-dialog]').forEach((button) => { button.disabled = false; });
      obligationForm.querySelectorAll('input, textarea, select').forEach((field) => {
        field.disabled = field.tagName === 'SELECT' && Boolean(state.pendingObligation?.uncertain);
      });
      submit.textContent = state.pendingObligation?.uncertain ? 'Reintentar mismo envío' : 'Guardar obligación';
    }
  });

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-open-contact]');
    if (!button) return;
    if (state.settlementDraft?.pendingCommit && state.settlementDraft.contactId !== button.dataset.openContact) {
      setStatus('Hay una liquidación sin resultado confirmado para otro contacto. Reintenta esa misma confirmación antes de cambiar de ficha.');
      return;
    }
    state.selectedContactId = button.dataset.openContact;
    state.selectedObligations = [];
    renderContactDetail();
    renderHistory();
    setStatus('Consultando ficha y obligaciones del contacto…');
    await loadSelectedObligations();
  });

  detail.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-contact-detail]')) {
      if (state.settlementDraft?.pendingCommit) {
        setStatus('Hay una confirmación de liquidación sin resultado definitivo. Reintenta la misma operación antes de cerrar esta ficha.');
        return;
      }
      state.selectedContactId = null;
      state.selectedObligations = [];
      state.settlementDraft = null;
      state.obligationRequest += 1;
      renderContactDetail();
      renderHistory();
    }
    if (event.target.closest('[data-add-obligation]')) openNewObligation();
    if (event.target.closest('[data-settlement-preview]')) void previewSettlementDraft();
    if (event.target.closest('[data-settlement-commit]')) void confirmSettlementDraft();
  });

  detail.addEventListener('input', (event) => {
    const target = event.target;
    const draft = state.settlementDraft;
    if (!draft || draft.pendingCommit) return;
    if (target.dataset.settlementField === 'amount') {
      draft.amount = target.value;
      invalidateSettlementPreview(draft);
    } else if (target.dataset.settlementAllocation) {
      draft.manualAllocations[target.dataset.settlementAllocation] = target.value;
      invalidateSettlementPreview(draft);
    }
  });

  detail.addEventListener('change', (event) => {
    const target = event.target;
    const draft = state.settlementDraft;
    if (!draft) return;
    if (target.dataset.settlementOverageConfirm && !draft.pendingCommit) {
      draft.overageConfirmed = target.checked;
      const commit = detail.querySelector('[data-settlement-commit]');
      if (commit) commit.disabled = !(draft.preview && !draft.commitBusy
        && (BigInt(draft.preview.overage_minor) === 0n || draft.overageConfirmed));
      return;
    }
    if (target.dataset.settlementField && !draft.pendingCommit) {
      const field = target.dataset.settlementField;
      if (['flow', 'currency', 'mode'].includes(field)) {
        draft[field] = target.value;
        invalidateSettlementPreview(draft);
        const manualList = detail.querySelector('[data-settlement-manual-list]');
        if (manualList) {
          manualList.hidden = draft.mode !== 'manual';
          renderManualSettlementAllocations(manualList, draft, false);
        }
      }
    }
  });

  search.addEventListener('input', renderContacts);
  currencyFilter.addEventListener('change', renderContacts);

  const tabs = Array.from(root.querySelectorAll('[data-fortuna-tab]'));
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.fortunaTab));
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      tabs[next].focus();
      activateTab(tabs[next].dataset.fortunaTab);
    });
  });

  window.loadFortunaData = () => loadContacts();
  window.resetFortunaPreviewDrafts = () => {
    state.sessionEpoch += 1;
    state.obligationRequest += 1;
    state.contacts = [];
    state.selectedContactId = null;
    state.selectedObligations = [];
    state.loadingContacts = false;
    state.loadingObligations = false;
    state.pendingContact = null;
    state.pendingObligation = null;
    state.settlementDraft = null;
    state.settlementPreviewRequest += 1;
    contactForm.reset();
    obligationForm.reset();
    search.value = '';
    currencyFilter.value = '';
    byId('fortuna-contact-form-error').textContent = '';
    byId('fortuna-obligation-form-error').textContent = '';
    closeDialog(contactDialog);
    closeDialog(obligationDialog);
    activateTab('overview');
    renderSummary();
    setStatus('Datos de la sesión anterior eliminados. Actualiza al entrar en tu libro.');
  };

  renderSummary();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarFortuna, { once: true });
} else {
  inicializarFortuna();
}
