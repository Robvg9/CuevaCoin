/**
 * FORTUNA v1 — local-only contact and obligation preview workbench.
 * Drafts exist only in RAM. No Supabase, network, or browser storage calls.
 */
import {
  formatMinorAmount,
  normalizeContactDraft,
  summarizeObligations,
  validateObligationDraft
} from './preview-domain.mjs';

function inicializarFortunaPreview() {
  const root = document.getElementById('shared-fortuna');
  if (!root || root.dataset.fortunaPreviewReady === 'true') return;
  root.dataset.fortunaPreviewReady = 'true';

  const state = { contacts: [], selectedContactId: null, sequence: 0 };
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
    console.error('[FORTUNA] Preview markup incomplete; UI was not initialized.');
    return;
  }

  const el = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };
  const setStatus = (message) => { status.textContent = message; };
  const selected = () => state.contacts.find((item) => item.id === state.selectedContactId) ?? null;
  const closeDialog = (dialog) => { if (dialog.open) dialog.close(); };
  const openDialog = (dialog, focusId) => {
    if (typeof dialog.showModal !== 'function') {
      setStatus('Este navegador no admite diálogos accesibles. Actualízalo para continuar.');
      return;
    }
    dialog.showModal();
    byId(focusId)?.focus();
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

  function renderBalance(container, summary) {
    const line = el('div', 'fortuna-contact-position');
    const receivable = el('div');
    receivable.append(el('span', '', 'Te debe'));
    receivable.append(el('strong', '', formatMinorAmount(summary.receivableMinor) + ' ' + summary.currency));
    const payable = el('div');
    payable.append(el('span', '', 'Le debes'));
    payable.append(el('strong', '', formatMinorAmount(summary.payableMinor) + ' ' + summary.currency));
    line.append(receivable, payable);
    container.append(line);
  }

  function getFilteredContacts() {
    const term = search.value.trim().toLocaleLowerCase();
    const currency = currencyFilter.value;
    return state.contacts
      .filter((contact) => {
        const matchesText = !term || (contact.displayName + ' ' + contact.phone).toLocaleLowerCase().includes(term);
        const matchesCurrency = !currency || summarizeObligations(contact.obligations).some((item) => item.currency === currency);
        return matchesText && matchesCurrency;
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' }));
  }

  function renderContacts() {
    list.replaceChildren();
    const contacts = getFilteredContacts();
    byId('fortuna-draft-contact-count').textContent =
      state.contacts.length + (state.contacts.length === 1 ? ' borrador' : ' borradores');

    if (!contacts.length) {
      const empty = el('div', 'fortuna-empty-state');
      empty.append(el('span', '', '👤'));
      empty.append(el('h3', '', state.contacts.length ? 'No hay coincidencias' : 'No hay borradores todavía'));
      empty.append(el('p', '', state.contacts.length
        ? 'Cambia el texto o el filtro de moneda.'
        : 'Usa «Nuevo contacto» para probar el formulario. No se guarda ningún dato real.'));
      list.append(empty);
      return;
    }

    for (const contact of contacts) {
      const card = el('article', 'fortuna-contact-card');
      const heading = el('div', 'fortuna-contact-card-head');
      heading.append(el('h3', '', contact.displayName), el('span', 'fortuna-draft-chip', 'Borrador local'));
      card.append(heading);
      if (contact.phone) card.append(el('small', '', contact.phone));

      const summaries = summarizeObligations(contact.obligations);
      if (summaries.length) summaries.forEach((summary) => renderBalance(card, summary));
      else card.append(el('small', '', 'Sin obligaciones en el borrador'));

      const open = el('button', 'btn btn-secondary', 'Abrir ficha');
      open.type = 'button';
      open.dataset.openContact = contact.id;
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
    identity.append(el('h3', '', contact.displayName));
    identity.append(el('p', '', [contact.phone, contact.notes].filter(Boolean).join(' · ') || 'Sin teléfono ni notas'));
    const close = el('button', 'btn btn-secondary', 'Cerrar ficha');
    close.type = 'button';
    close.dataset.closeContactDetail = 'true';
    heading.append(identity, close);
    detail.append(heading);

    const summaries = summarizeObligations(contact.obligations);
    if (summaries.length) {
      const totals = el('div', 'fortuna-detail-totals');
      for (const summary of summaries) {
        const item = el('div', 'fortuna-detail-total');
        if (summary.mixed) item.append(el('small', '', 'Posición mixta en ' + summary.currency));
        item.append(el('strong', '', 'Te debe: ' + formatMinorAmount(summary.receivableMinor) + ' ' + summary.currency));
        item.append(el('strong', '', 'Le debes: ' + formatMinorAmount(summary.payableMinor) + ' ' + summary.currency));
        totals.append(item);
      }
      detail.append(totals);
    } else {
      detail.append(el('p', '', 'Este borrador todavía no tiene obligaciones.'));
    }

    const add = el('button', 'btn btn-primary', '＋ Añadir obligación (borrador)');
    add.type = 'button';
    add.dataset.addObligation = 'true';
    detail.append(add);

    if (contact.obligations.length) {
      detail.append(el('h4', '', 'Obligaciones de vista previa'));
      const rows = el('div', 'fortuna-obligation-list');
      for (const obligation of contact.obligations) {
        const row = el('article', 'fortuna-obligation-row');
        const copy = el('div');
        copy.append(el('strong', '', obligation.description));
        copy.append(el('p', '', (obligation.direction === 'receivable' ? 'Te deben' : 'Tú debes')
          + ' · ' + obligation.currency
          + (obligation.dueDate ? ' · Vence ' + obligation.dueDate : '')));
        row.append(copy, el('span', '', formatMinorAmount(obligation.amountMinor) + ' ' + obligation.currency));
        rows.append(row);
      }
      detail.append(rows);
    }
    byId('fortuna-new-obligation-btn').disabled = false;
  }

  function renderHistory() {
    history.replaceChildren();
    const records = state.contacts.flatMap((contact) =>
      contact.obligations.map((obligation) => ({ contact, obligation })));

    if (!records.length) {
      const empty = el('div', 'fortuna-empty-state');
      empty.append(el('span', '', '📚'));
      empty.append(el('h3', '', 'Sin obligaciones de vista previa'));
      empty.append(el('p', '', 'Abre la ficha de un contacto y añade una obligación para ver su presentación.'));
      history.append(empty);
      return;
    }

    for (const { contact, obligation } of records.slice().reverse()) {
      const row = el('article', 'fortuna-preview-history-row');
      const copy = el('div');
      copy.append(el('strong', '', obligation.description));
      copy.append(el('small', '', contact.displayName + ' · '
        + (obligation.direction === 'receivable' ? 'Te deben' : 'Tú debes') + ' · Borrador local'));
      row.append(copy, el('span', '', formatMinorAmount(obligation.amountMinor) + ' ' + obligation.currency));
      history.append(row);
    }
  }

  function renderSummary() {
    const totals = new Map();
    for (const contact of state.contacts) {
      for (const item of summarizeObligations(contact.obligations)) {
        const current = totals.get(item.currency) ?? { receivable: 0n, payable: 0n };
        current.receivable += BigInt(item.receivableMinor);
        current.payable += BigInt(item.payableMinor);
        totals.set(item.currency, current);
      }
    }

    const summaryText = (key) => [...totals.entries()]
      .filter(([, amounts]) => amounts[key] > 0n)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amounts]) => formatMinorAmount(amounts[key].toString()) + ' ' + currency)
      .join(' · ') || '—';

    const cards = root.querySelectorAll('.fortuna-summary-card');
    if (cards[0]) {
      cards[0].querySelector('strong').textContent = summaryText('receivable');
      cards[0].querySelector('small').textContent = 'Solo borradores de esta sesión';
    }
    if (cards[1]) {
      cards[1].querySelector('strong').textContent = summaryText('payable');
      cards[1].querySelector('small').textContent = 'Solo borradores de esta sesión';
    }
    if (cards[2]) {
      cards[2].querySelector('strong').textContent = String(state.contacts.length);
      cards[2].querySelector('small').textContent = 'Borradores volátiles, no guardados';
    }
    renderContacts();
    renderContactDetail();
    renderHistory();
  }

  function openNewContact() {
    contactForm.reset();
    byId('fortuna-contact-form-error').textContent = '';
    openDialog(contactDialog, 'fortuna-contact-name');
  }

  function openNewObligation() {
    const contact = selected();
    if (!contact) {
      setStatus('Primero abre la ficha de un contacto de vista previa.');
      return;
    }
    obligationForm.reset();
    byId('fortuna-obligation-form-error').textContent = '';
    byId('fortuna-obligation-contact').textContent = 'Contacto de vista previa: ' + contact.displayName;
    openDialog(obligationDialog, 'fortuna-obligation-amount');
  }

  byId('fortuna-new-contact-btn').addEventListener('click', openNewContact);
  byId('fortuna-new-obligation-btn').addEventListener('click', openNewObligation);

  root.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => closeDialog(byId(button.dataset.closeDialog)));
  });
  root.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });

  contactForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const error = byId('fortuna-contact-form-error');
    error.textContent = '';
    try {
      const contact = normalizeContactDraft({
        name: byId('fortuna-contact-name').value,
        phone: byId('fortuna-contact-phone').value,
        notes: byId('fortuna-contact-notes').value
      });
      const draft = {
        id: 'draft-' + (++state.sequence),
        displayName: contact.displayName,
        phone: contact.phone,
        notes: contact.notes,
        obligations: []
      };
      state.contacts.push(draft);
      state.selectedContactId = draft.id;
      search.value = '';
      currencyFilter.value = '';
      closeDialog(contactDialog);
      setStatus('Borrador local creado en memoria. No se ha guardado en CuevaCoin.');
      activateTab('contacts');
      renderSummary();
    } catch (validationError) {
      error.textContent = validationError.message;
    }
  });

  obligationForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const error = byId('fortuna-obligation-form-error');
    error.textContent = '';
    const contact = selected();
    if (!contact) {
      error.textContent = 'La ficha de contacto ya no está disponible. Cierra el formulario y vuelve a seleccionarla.';
      return;
    }
    try {
      const obligation = validateObligationDraft({
        direction: byId('fortuna-obligation-direction').value,
        currency: byId('fortuna-obligation-currency').value,
        amount: byId('fortuna-obligation-amount').value,
        description: byId('fortuna-obligation-description').value
      });
      // The server returns bigint totals per currency/direction. Validate the
      // full local book before mutating draft state so the preview never shows
      // a balance that the authoritative API cannot represent.
      summarizeObligations(state.contacts.flatMap((item) => item.obligations).concat(obligation));
      contact.obligations.push({
        ...obligation,
        dueDate: byId('fortuna-obligation-due-date').value,
        previewOnly: true
      });
      closeDialog(obligationDialog);
      setStatus('Obligación añadida como borrador. No se ha creado un evento ni un asiento.');
      renderSummary();
    } catch (validationError) {
      error.textContent = validationError.message;
    }
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-contact]');
    if (!button) return;
    state.selectedContactId = button.dataset.openContact;
    renderContactDetail();
    setStatus('Ficha de vista previa abierta. Los datos siguen solo en memoria.');
  });

  detail.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-contact-detail]')) {
      state.selectedContactId = null;
      renderContactDetail();
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

  window.resetFortunaPreviewDrafts = () => {
    closeDialog(contactDialog);
    closeDialog(obligationDialog);
    contactForm.reset();
    obligationForm.reset();
    byId('fortuna-contact-form-error').textContent = '';
    byId('fortuna-obligation-form-error').textContent = '';
    state.contacts = [];
    state.selectedContactId = null;
    state.sequence = 0;
    activateTab('overview');
    setStatus('Borradores locales eliminados al cambiar la sesión.');
    renderSummary();
  };

  renderSummary();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarFortunaPreview, { once: true });
} else {
  inicializarFortunaPreview();
}
