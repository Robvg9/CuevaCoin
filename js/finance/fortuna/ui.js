/**
 * FORTUNA v1 — owner-scoped contacts and obligations UI.
 * All persisted data flows through the authenticated Edge dispatcher.
 * The browser never accesses private tables or calculates ledger balances.
 */
import {
  formatMinorAmount,
  normalizeContactDraft,
  validateObligationDraft,
} from './preview-domain.mjs';
import {
  createContact,
  createIdempotencyKey,
  listContacts,
  listObligations,
  openObligation,
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
    state.selectedContactId = button.dataset.openContact;
    state.selectedObligations = [];
    renderContactDetail();
    renderHistory();
    setStatus('Consultando ficha y obligaciones del contacto…');
    await loadSelectedObligations();
  });

  detail.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-contact-detail]')) {
      state.selectedContactId = null;
      state.selectedObligations = [];
      state.obligationRequest += 1;
      renderContactDetail();
      renderHistory();
    }
    if (event.target.closest('[data-add-obligation]')) openNewObligation();
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
