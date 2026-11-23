/**
 * FORTUNA v1 — authenticated API client.
 * Calls only the allowlisted Edge dispatcher with the current user's JWT.
 * No service-role key, direct PostgREST table access, browser storage or retry.
 */

const EDGE_FUNCTION = 'fortuna-dispatch';
const ALLOWED_OPERATIONS = new Set([
  'create_contact',
  'open_obligation',
  'list_contacts',
  'list_obligations',
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
      IDEMPOTENCY_CONFLICT: 'La operación ya utilizó esta clave con otros datos. Actualiza la vista antes de continuar.',
      FORTUNA_API_SCHEMA_NOT_EXPOSED: 'El servicio FORTUNA no está disponible temporalmente.',
      FORTUNA_API_MIGRATION_NOT_AVAILABLE: 'El servicio FORTUNA necesita una actualización.',
      SERVICE_UNAVAILABLE: 'El servicio FORTUNA no está disponible temporalmente.',
      FORTUNA_OPERATION_REJECTED: 'El servidor rechazó la operación. Revisa los datos e inténtalo de nuevo.',
    };
    return new FortunaApiError(code, messages[code] || 'No se pudo completar la operación.', { status });
  }
  return new FortunaApiError(
    status ? 'HTTP_ERROR' : 'NETWORK_UNCERTAIN',
    status ? 'El servidor no pudo completar la solicitud.' : 'No se pudo confirmar la respuesta del servidor. Actualiza los datos antes de repetir.',
    { status, retryable: !status }
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

export async function listContacts() {
  const result = await invokeFortuna('list_contacts', {});
  if (!Array.isArray(result)) throw new FortunaApiError('INVALID_RESPONSE', 'La lista de contactos no es válida.');
  return result;
}

export async function createContact({ displayName, phone = '', notes = '', idempotencyKey }) {
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
  return invokeFortuna('list_obligations', {
    p_contact_id: contactId,
    p_currency_code: currencyCode,
    p_direction: direction,
  });
}

export async function openObligation({
  contactId, direction, currency, amountMinor, description, dueAt = null, idempotencyKey,
}) {
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

export async function previewSettlement({
  contactId, currency, flow, mode, totalAmountMinor, requestedAllocations = [],
}) {
  return invokeFortuna('preview_settlement', {
    p_contact_id: contactId,
    p_currency_code: currency,
    p_flow: flow,
    p_mode: mode,
    p_total_amount_minor: totalAmountMinor,
    p_requested_allocations: requestedAllocations,
  });
}

export async function receiveCash({
  contactId, currency, mode, totalAmountMinor, requestedAllocations = [],
  previewFingerprint, confirmOverage = false, idempotencyKey,
}) {
  return invokeFortuna('receive_cash', {
    p_contact_id: contactId,
    p_currency_code: currency,
    p_mode: mode,
    p_total_amount_minor: totalAmountMinor,
    p_requested_allocations: requestedAllocations,
    p_preview_fingerprint: previewFingerprint,
    p_confirm_overage: confirmOverage,
    p_idempotency_key: idempotencyKey,
  });
}

export async function payContact({
  contactId, currency, mode, totalAmountMinor, requestedAllocations = [],
  previewFingerprint, confirmOverage = false, idempotencyKey,
}) {
  return invokeFortuna('pay_contact', {
    p_contact_id: contactId,
    p_currency_code: currency,
    p_mode: mode,
    p_total_amount_minor: totalAmountMinor,
    p_requested_allocations: requestedAllocations,
    p_preview_fingerprint: previewFingerprint,
    p_confirm_overage: confirmOverage,
    p_idempotency_key: idempotencyKey,
  });
}
