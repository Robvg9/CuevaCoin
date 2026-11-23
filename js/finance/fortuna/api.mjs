/**
 * FORTUNA v1 — authenticated API client.
 * Calls only the allowlisted Edge dispatcher with the current user's JWT.
 * No service-role key, direct PostgREST table access, browser storage or retry.
 */

import { FORTUNA_CURRENCIES, MAX_MINOR_UNITS } from './preview-domain.mjs';

const EDGE_FUNCTION = 'fortuna-dispatch';
const ALLOWED_OPERATIONS = new Set([
  'create_contact',
  'open_obligation',
  'list_contacts',
  'list_obligations',
  'list_activity',
  'search_fortuna_profiles',
  'link_fortuna_profile_contact',
  'set_fortuna_profile_dependent_role',
  'preview_fortuna_profile_history_migration',
  'migrate_fortuna_profile_history',
  'preview_settlement',
  'receive_cash',
  'pay_contact',
]);

export class FortunaApiError extends Error {
  constructor(code, message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = 'FortunaApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function clientOrThrow() {
  const client = globalThis.window?.supabaseClient;
  if (!client?.auth?.getSession || !client?.functions?.invoke) {
    throw new FortunaApiError('CLIENT_UNAVAILABLE', 'El servicio de CuevaCoin no está disponible.');
  }
  return client;
}

async function readFunctionError(error) {
  const response = error?.context;
  let body = null;
  if (response && typeof response.json === 'function') {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  const status = Number(response?.status) || 0;
  const code = typeof body?.error === 'string' ? body.error : '';
  if (code) {
    const messages = {
      AUTH_REQUIRED: 'La sesión no está disponible. Vuelve a iniciar sesión.',
      AUTH_INVALID: 'La sesión ya no es válida. Vuelve a iniciar sesión.',
      UNAUTHORIZED_INVALID_JWT_FORMAT: 'La sesión no es válida. Vuelve a iniciar sesión.',
      IDEMPOTENCY_CONFLICT: 'La operación ya utilizó esta clave con otros datos. No repitas la liquidación con otra clave.',
      STALE_PREVIEW: 'El saldo cambió después de la vista previa. Se descartó el plan; genera y revisa uno nuevo.',
      FORTUNA_API_SCHEMA_NOT_EXPOSED: 'El servicio FORTUNA no está disponible temporalmente.',
      FORTUNA_API_MIGRATION_NOT_AVAILABLE: 'El servicio FORTUNA necesita una actualización.',
      SERVICE_UNAVAILABLE: 'El servicio FORTUNA no está disponible temporalmente.',
      FORTUNA_OPERATION_REJECTED: 'El servidor rechazó la operación. Revisa los datos e inténtalo de nuevo.',
    };
    return new FortunaApiError(code, messages[code] || 'No se pudo completar la operación.', { status, retryable: status >= 500 });
  }
  return new FortunaApiError(
    status ? 'HTTP_ERROR' : 'NETWORK_UNCERTAIN',
    status ? 'El servidor no pudo completar la solicitud.' : 'No se pudo confirmar la respuesta del servidor. Actualiza los datos antes de repetir.',
    { status, retryable: status >= 500 || !status }
  );
}

async function invokeFortuna(operation, args) {
  if (!ALLOWED_OPERATIONS.has(operation)) {
    throw new FortunaApiError('OPERATION_NOT_ALLOWED', 'La operación solicitada no está permitida.');
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new FortunaApiError('INVALID_ARGUMENTS', 'Los datos de la operación no son válidos.');
  }

  const client = clientOrThrow();
  let sessionResult;
  try {
    sessionResult = await client.auth.getSession();
  } catch {
    throw new FortunaApiError('AUTH_REQUIRED', 'No se pudo recuperar la sesión actual.');
  }
  if (sessionResult?.error) {
    throw new FortunaApiError('AUTH_REQUIRED', 'No se pudo recuperar la sesión actual.');
  }
  const accessToken = sessionResult?.data?.session?.access_token;
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new FortunaApiError('AUTH_REQUIRED', 'Inicia sesión para acceder a tu libro FORTUNA.');
  }

  let result;
  try {
    result = await client.functions.invoke(EDGE_FUNCTION, {
      body: { operation, args },
      headers: { Authorization: 'Bearer ' + accessToken },
    });
  } catch {
    throw new FortunaApiError(
      'NETWORK_UNCERTAIN',
      'No se pudo confirmar la respuesta del servidor. Actualiza los datos antes de repetir.',
      { retryable: true }
    );
  }
  if (result?.error) throw await readFunctionError(result.error);

  const envelope = result?.data;
  if (!envelope || typeof envelope !== 'object' || !Object.prototype.hasOwnProperty.call(envelope, 'data')) {
    throw new FortunaApiError('INVALID_RESPONSE', 'El servidor devolvió una respuesta inesperada.');
  }
  return envelope.data;
}

export function createIdempotencyKey() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new FortunaApiError('SECURE_RANDOM_UNAVAILABLE', 'Este navegador no permite generar una clave segura.');
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

function validateMinorString(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) return false;
  try {
    return BigInt(value) <= MAX_MINOR_UNITS;
  } catch {
    return false;
  }
}

export async function listContacts() {
  const result = await invokeFortuna('list_contacts', {});
  if (!Array.isArray(result)) throw new FortunaApiError('INVALID_RESPONSE', 'La lista de contactos no es válida.');
  for (const contact of result) {
    if (!contact || typeof contact.contact_id !== 'string' || !contact.contact_id
      || typeof contact.display_name !== 'string' || !Array.isArray(contact.currencies)
      || (contact.linked_profile_id !== undefined && contact.linked_profile_id !== null && typeof contact.linked_profile_id !== 'string')
      || (contact.is_dependent !== undefined && contact.is_dependent !== null && typeof contact.is_dependent !== 'boolean')
      || (contact.history_migrated !== undefined && typeof contact.history_migrated !== 'boolean')) {
      throw new FortunaApiError('INVALID_RESPONSE', 'El servidor devolvió un contacto incompleto.');
    }
    for (const position of contact.currencies) {
      if (!FORTUNA_CURRENCIES.includes(position?.currency)
        || !validateMinorString(position.te_debe_minor)
        || !validateMinorString(position.le_debes_minor)) {
        throw new FortunaApiError('INVALID_RESPONSE', 'El servidor devolvió un saldo inválido.');
      }
    }
  }
  return result;
}

export async function createContact({ displayName, phone = '', notes = '', idempotencyKey }) {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
    throw new FortunaApiError('INVALID_ARGUMENTS', 'Falta una clave idempotente segura.');
  }
  return invokeFortuna('create_contact', {
    p_display_name: displayName,
    p_phone: phone || null,
    p_notes: notes || null,
    p_idempotency_key: idempotencyKey,
  });
}

export async function listObligations(contactId, currencyCode = null, direction = null) {
  if (typeof contactId !== 'string' || !contactId.trim()) {
    throw new FortunaApiError('INVALID_ARGUMENTS', 'Selecciona un contacto válido.');
  }
  const result = await invokeFortuna('list_obligations', {
    p_contact_id: contactId,
    p_currency_code: currencyCode,
    p_direction: direction,
  });
  if (!Array.isArray(result)) throw new FortunaApiError('INVALID_RESPONSE', 'La lista de obligaciones no es válida.');
  for (const obligation of result) {
    if (!obligation || typeof obligation.obligation_id !== 'string'
      || !FORTUNA_CURRENCIES.includes(obligation.currency)
      || !['receivable', 'payable'].includes(obligation.direction)
      || !validateMinorString(obligation.principal_minor)
      || !validateMinorString(obligation.remaining_minor)
      || typeof obligation.description !== 'string') {
      throw new FortunaApiError('INVALID_RESPONSE', 'El servidor devolvió una obligación incompleta.');
    }
  }
  return result;
}

export async function previewFortunaProfileHistoryMigration(contactId) {
  if (typeof contactId !== 'string' || !contactId.trim()) {
    throw new FortunaApiError('INVALID_ARGUMENTS', 'Selecciona un contacto válido.');
  }
  const result = await invokeFortuna('preview_fortuna_profile_history_migration', {
    p_contact_id: contactId,
  });
  if (!result || typeof result !== 'object' || typeof result.ready !== 'boolean'
    || typeof result.transaction_count !== 'number'
    || typeof result.withdrawal_request_count !== 'number'
    || typeof result.reconciliation_count !== 'number'
    || typeof result.source_balance_minor !== 'string'
    || typeof result.historical_principal_minor !== 'string'
    || !Array.isArray(result.reconciliation_gaps)) {
    throw new FortunaApiError('INVALID_RESPONSE', 'La vista previa de migración no es válida.');
  }
  return result;
}

export async function migrateFortunaProfileHistory(contactId) {
  if (typeof contactId !== 'string' || !contactId.trim()) {
    throw new FortunaApiError('INVALID_ARGUMENTS', 'Selecciona un contacto válido.');
  }
  const result = await invokeFortuna('migrate_fortuna_profile_history', {
    p_contact_id: contactId,
  });
  if (!result || result.success !== true || typeof result.transaction_count !== 'number'
    || typeof result.withdrawal_request_count !== 'number'
    || typeof result.source_balance_minor !== 'string') {
    throw new FortunaApiError('INVALID_RESPONSE', 'El resultado de la migración no es válido.');
  }
  return result;
}

export async function listActivity(contactId, { limit = 50, before = null } = {}) {
  if (typeof contactId !== 'string' || !contactId.trim()
    || !Number.isInteger(limit) || limit < 1 || limit > 100
    || (before !== null && (!before || typeof before.event_id !== 'string'
      || typeof before.occurred_at !== 'string' || Number.isNaN(Date.parse(before.occurred_at))))) {
    throw new FortunaApiError('INVALID_ARGUMENTS', 'Los parámetros del historial no son válidos.');
  }

  const result = await invokeFortuna('list_activity', {
    p_contact_id: contactId,
    p_limit: limit,
    p_before_occurred_at: before?.occurred_at ?? null,
    p_before_event_id: before?.event_id ?? null,
  });
  const invalid = () => { throw new FortunaApiError('INVALID_RESPONSE', 'El servidor devolvió un historial incompleto o inválido.'); };
  const eventTypes = new Set(['obligation_opened', 'cash_received', 'cash_paid', 'compensation', 'reversal', 'adjustment', 'legacy_history']);
  const entryKinds = new Set(['obligation_opened', 'cash_received', 'cash_paid', 'compensation', 'reversal', 'adjustment']);
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || !Array.isArray(result.items) || typeof result.has_more !== 'boolean') invalid();

  for (const item of result.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.event_id !== 'string' || !item.event_id
      || !eventTypes.has(item.event_type)
      || !FORTUNA_CURRENCIES.includes(item.currency)
      || !validateMinorString(item.total_amount_minor) || BigInt(item.total_amount_minor) <= 0n
      || typeof item.occurred_at !== 'string' || Number.isNaN(Date.parse(item.occurred_at))
      || !(item.reversal_reason === null || typeof item.reversal_reason === 'string')
      || !(item.audit_action === null || typeof item.audit_action === 'string')
      || !item.metadata || typeof item.metadata !== 'object' || Array.isArray(item.metadata)
      || !Array.isArray(item.ledger_entries)) invalid();
    for (const entry of item.ledger_entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || typeof entry.obligation_id !== 'string' || !entry.obligation_id
        || typeof entry.description !== 'string'
        || !validateMinorString(entry.amount_minor) || BigInt(entry.amount_minor) <= 0n
        || !entryKinds.has(entry.entry_kind)) invalid();
    }
  }

  if (result.has_more) {
    const last = result.items.at(-1);
    if (!last || !result.next_cursor
      || result.next_cursor.event_id !== last.event_id
      || result.next_cursor.occurred_at !== last.occurred_at) invalid();
  } else if (result.next_cursor !== null) {
    invalid();
  }
  return result;
}

export async function openObligation({
  contactId, direction, currency, amountMinor, description, dueAt = null, idempotencyKey,
}) {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
    throw new FortunaApiError('INVALID_ARGUMENTS', 'Falta una clave idempotente segura.');
  }
  return invokeFortuna('open_obligation', {
    p_contact_id: contactId,
    p_direction: direction,
    p_currency_code: currency,
    p_amount_minor: amountMinor,
    p_description: description,
    p_due_at: dueAt,
    p_idempotency_key: idempotencyKey,
  });
}

function validateSettlementPreview(plan, expected) {
  const invalid = () => { throw new FortunaApiError('INVALID_RESPONSE', 'El servidor devolvió una vista previa de liquidación incompleta.'); };
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)
    || !FORTUNA_CURRENCIES.includes(plan.currency)
    || plan.contact_id !== expected.contactId
    || plan.currency !== expected.currency
    || plan.flow !== expected.flow
    || plan.mode !== expected.mode
    || plan.total_amount_minor !== expected.totalAmountMinor
    || !['cash_received', 'cash_paid'].includes(plan.flow)
    || !['fifo', 'manual'].includes(plan.mode)
    || !validateMinorString(plan.total_amount_minor)
    || !validateMinorString(plan.allocated_minor)
    || !validateMinorString(plan.overage_minor)
    || typeof plan.preview_fingerprint !== 'string'
    || !/^[0-9a-f]{64}$/.test(plan.preview_fingerprint)
    || !Array.isArray(plan.eligible_obligations)
    || !Array.isArray(plan.allocations)) invalid();

  const eligibleIds = new Set();
  const eligibleById = new Map();
  for (const obligation of plan.eligible_obligations) {
    if (!obligation || typeof obligation.obligation_id !== 'string' || !obligation.obligation_id
      || eligibleIds.has(obligation.obligation_id)
      || !validateMinorString(obligation.remaining_minor)
      || BigInt(obligation.remaining_minor) <= 0n
      || typeof obligation.opened_at !== 'string') invalid();
    eligibleIds.add(obligation.obligation_id);
    eligibleById.set(obligation.obligation_id, obligation);
  }

  const allocatedIds = new Set();
  let allocationSum = 0n;
  for (const allocation of plan.allocations) {
    if (!allocation || typeof allocation.obligation_id !== 'string'
      || !eligibleIds.has(allocation.obligation_id)
      || allocatedIds.has(allocation.obligation_id)
      || !validateMinorString(allocation.amount_minor)
      || BigInt(allocation.amount_minor) <= 0n) invalid();
    allocatedIds.add(allocation.obligation_id);
    if (BigInt(allocation.amount_minor) > BigInt(eligibleById.get(allocation.obligation_id).remaining_minor)) invalid();
    allocationSum += BigInt(allocation.amount_minor);
  }

  const total = BigInt(plan.total_amount_minor);
  const allocated = BigInt(plan.allocated_minor);
  const overage = BigInt(plan.overage_minor);
  if (total <= 0n || allocationSum !== allocated || allocated + overage !== total) invalid();
  if (plan.mode === 'fifo') {
    const eligibleOrder = new Map(plan.eligible_obligations.map((item, index) => [item.obligation_id, index]));
    const allocationOrder = plan.allocations.map((item) => eligibleOrder.get(item.obligation_id));
    if (allocationOrder.some((value, index) => index > 0 && value <= allocationOrder[index - 1])) invalid();
  }
  const expectedOverageDirection = plan.flow === 'cash_received' ? 'payable' : 'receivable';
  if ((overage > 0n && plan.overage_direction !== expectedOverageDirection)
    || (overage === 0n && plan.overage_direction !== null)) invalid();
  return plan;
}

function validateSettlementCommit(result, expected) {
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || typeof result.event_id !== 'string' || !result.event_id
    || !['cash_received', 'cash_paid'].includes(result.flow)
    || !['fifo', 'manual'].includes(result.mode)
    || !FORTUNA_CURRENCIES.includes(result.currency)
    || result.flow !== expected.flow
    || result.mode !== expected.mode
    || result.currency !== expected.currency
    || result.total_amount_minor !== expected.totalAmountMinor
    || !validateMinorString(result.total_amount_minor)
    || !validateMinorString(result.allocated_minor)
    || !validateMinorString(result.overage_minor)
    || !Array.isArray(result.allocations)
    || !(result.overage_obligation_id === null || typeof result.overage_obligation_id === 'string')) {
    throw new FortunaApiError('INVALID_RESPONSE', 'El servidor devolvió una confirmación de liquidación incompleta.');
  }
  let allocationSum = 0n;
  const ids = new Set();
  for (const allocation of result.allocations) {
    if (!allocation || typeof allocation.obligation_id !== 'string'
      || ids.has(allocation.obligation_id)
      || !validateMinorString(allocation.amount_minor)
      || BigInt(allocation.amount_minor) <= 0n) {
      throw new FortunaApiError('INVALID_RESPONSE', 'El servidor devolvió asignaciones de liquidación inválidas.');
    }
    ids.add(allocation.obligation_id);
    allocationSum += BigInt(allocation.amount_minor);
  }
  if (allocationSum !== BigInt(result.allocated_minor)
    || BigInt(result.allocated_minor) + BigInt(result.overage_minor) !== BigInt(result.total_amount_minor)
    || ((BigInt(result.overage_minor) > 0n) !== Boolean(result.overage_obligation_id))) {
    throw new FortunaApiError('INVALID_RESPONSE', 'Los importes de la confirmación de liquidación no cuadran.');
  }
  return result;
}

export async function previewSettlement({
  contactId, currency, flow, mode, totalAmountMinor, requestedAllocations = [],
}) {
  const result = await invokeFortuna('preview_settlement', {
    p_contact_id: contactId,
    p_currency_code: currency,
    p_flow: flow,
    p_mode: mode,
    p_total_amount_minor: totalAmountMinor,
    p_requested_allocations: requestedAllocations,
  });
  return validateSettlementPreview(result, { contactId, currency, flow, mode, totalAmountMinor });
}

export async function receiveCash({
  contactId, currency, mode, totalAmountMinor, requestedAllocations = [],
  previewFingerprint, confirmOverage = false, idempotencyKey,
}) {
  validateSettlementCommitRequest({ previewFingerprint, confirmOverage, idempotencyKey, requestedAllocations });
  return validateSettlementCommit(await invokeFortuna('receive_cash', {
    p_contact_id: contactId,
    p_currency_code: currency,
    p_mode: mode,
    p_total_amount_minor: totalAmountMinor,
    p_requested_allocations: requestedAllocations,
    p_preview_fingerprint: previewFingerprint,
    p_confirm_overage: confirmOverage,
    p_idempotency_key: idempotencyKey,
  }), { flow: 'cash_received', mode, currency, totalAmountMinor });
}

function validateSettlementCommitRequest({ previewFingerprint, confirmOverage, idempotencyKey, requestedAllocations }) {
  if (typeof previewFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(previewFingerprint)
    || typeof confirmOverage !== 'boolean'
    || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8
    || !Array.isArray(requestedAllocations)) {
    throw new FortunaApiError('INVALID_ARGUMENTS', 'Faltan los datos seguros de confirmación de la liquidación.');
  }
}

export async function payContact({
  contactId, currency, mode, totalAmountMinor, requestedAllocations = [],
  previewFingerprint, confirmOverage = false, idempotencyKey,
}) {
  validateSettlementCommitRequest({ previewFingerprint, confirmOverage, idempotencyKey, requestedAllocations });
  return validateSettlementCommit(await invokeFortuna('pay_contact', {
    p_contact_id: contactId,
    p_currency_code: currency,
    p_mode: mode,
    p_total_amount_minor: totalAmountMinor,
    p_requested_allocations: requestedAllocations,
    p_preview_fingerprint: previewFingerprint,
    p_confirm_overage: confirmOverage,
    p_idempotency_key: idempotencyKey,
  }), { flow: 'cash_paid', mode, currency, totalAmountMinor });
}


export async function searchFortunaProfiles(query) {
  const normalized = String(query ?? '').trim();
  if (normalized.length < 2 || normalized.length > 80) {
    throw new FortunaApiError('INVALID_ARGUMENTS', 'Escribe al menos 2 caracteres para buscar usuarios.');
  }
  const result = await invokeFortuna('search_fortuna_profiles', { p_query: normalized });
  if (!Array.isArray(result)) throw new FortunaApiError('INVALID_RESPONSE', 'La búsqueda de usuarios no es válida.');
  return result.filter((item) => item && typeof item.profile_id === 'string'
    && typeof item.username === 'string' && typeof item.display_name === 'string'
    && typeof item.is_dependent === 'boolean'
    && typeof item.is_fortuna_contact === 'boolean');
}

export async function linkFortunaProfileContact(profileId, isDependent = false) {
  if (typeof profileId !== 'string' || !profileId.trim() || typeof isDependent !== 'boolean') {
    throw new FortunaApiError('INVALID_ARGUMENTS', 'Selecciona un usuario y una clasificación válidos.');
  }
  const result = await invokeFortuna('link_fortuna_profile_contact', {
    p_profile_id: profileId,
    p_is_dependent: isDependent,
  });
  if (!result || typeof result.contact_id !== 'string'
    || !/^\d+$/.test(String(result.balance_minor ?? '0'))
    || result.is_dependent !== isDependent
    || typeof result.is_new_contact !== 'boolean') {
    throw new FortunaApiError('INVALID_RESPONSE', 'No se pudo vincular y clasificar el usuario.');
  }
  return { ...result, balance_minor: String(result.balance_minor ?? '0') };
}

export async function setFortunaProfileDependentRole(profileId, isDependent) {
  if (typeof profileId !== 'string' || !profileId.trim() || typeof isDependent !== 'boolean') {
    throw new FortunaApiError('INVALID_ARGUMENTS', 'Selecciona una cuenta y una clasificación válidas.');
  }
  const result = await invokeFortuna('set_fortuna_profile_dependent_role', {
    p_profile_id: profileId,
    p_is_dependent: isDependent,
  });
  if (!result || result.profile_id !== profileId || result.is_dependent !== isDependent) {
    throw new FortunaApiError('INVALID_RESPONSE', 'No se pudo actualizar la clasificación de la cuenta.');
  }
  return result;
}
