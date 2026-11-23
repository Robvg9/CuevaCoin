import assert from 'node:assert/strict';
import {
  FortunaApiError,
  createContact,
  createIdempotencyKey,
  listContacts,
  listObligations,
  openObligation,
  previewSettlement,
  receiveCash,
  payContact,
} from '../js/finance/fortuna/api.mjs';

const calls = [];
let session = { access_token: 'test-user-jwt-never-sent-to-network' };
let nextResult = { data: { data: [] }, error: null };
let nextError = null;

globalThis.window = {
  supabaseClient: {
    auth: {
      async getSession() {
        return { data: { session: session ? { access_token: session.access_token } : null }, error: null };
      },
    },
    functions: {
      async invoke(name, options) {
        calls.push({ name, options });
        if (nextError) {
          const error = nextError;
          nextError = null;
          return { data: null, error };
        }
        return nextResult;
      },
    },
  },
};

function lastCall(operation, args) {
  const call = calls.at(-1);
  assert.equal(call.name, 'fortuna-dispatch');
  assert.equal(call.options.body.operation, operation);
  assert.deepEqual(call.options.body.args, args);
  assert.equal(call.options.headers.Authorization, 'Bearer test-user-jwt-never-sent-to-network');
}

assert.match(createIdempotencyKey(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

nextResult = { data: { data: [{ contact_id: 'c1', display_name: 'María', currencies: [{ currency: 'CUP', te_debe_minor: '10000', le_debes_minor: '0', position_type: 'receivable' }] }] }, error: null };
assert.deepEqual(await listContacts(), [{ contact_id: 'c1', display_name: 'María', currencies: [{ currency: 'CUP', te_debe_minor: '10000', le_debes_minor: '0', position_type: 'receivable' }] }]);
lastCall('list_contacts', {});

const contactKey = 'contact-idempotency-0001';
nextResult = { data: { data: { contact_id: 'c1', display_name: 'María' } }, error: null };
assert.deepEqual(await createContact({
  displayName: 'María',
  phone: '',
  notes: 'Nota',
  idempotencyKey: contactKey,
}), { contact_id: 'c1', display_name: 'María' });
lastCall('create_contact', {
  p_display_name: 'María',
  p_phone: null,
  p_notes: 'Nota',
  p_idempotency_key: contactKey,
});

nextResult = { data: { data: [{ obligation_id: 'o1', contact_id: 'c1', currency: 'CUP', direction: 'receivable', principal_minor: '10000', remaining_minor: '10000', description: 'Préstamo', due_at: null }] }, error: null };
assert.deepEqual(await listObligations('c1', 'CUP', 'receivable'), [
  { obligation_id: 'o1', contact_id: 'c1', currency: 'CUP', direction: 'receivable', principal_minor: '10000', remaining_minor: '10000', description: 'Préstamo', due_at: null },
]);
lastCall('list_obligations', {
  p_contact_id: 'c1',
  p_currency_code: 'CUP',
  p_direction: 'receivable',
});

const obligationKey = 'obligation-idempotency-001';
nextResult = { data: { data: { obligation_id: 'o1', amount_minor: '12550' } }, error: null };
assert.deepEqual(await openObligation({
  contactId: 'c1',
  direction: 'receivable',
  currency: 'CUP',
  amountMinor: '12550',
  description: 'Préstamo',
  dueAt: null,
  idempotencyKey: obligationKey,
}), { obligation_id: 'o1', amount_minor: '12550' });
lastCall('open_obligation', {
  p_contact_id: 'c1',
  p_direction: 'receivable',
  p_currency_code: 'CUP',
  p_amount_minor: '12550',
  p_description: 'Préstamo',
  p_due_at: null,
  p_idempotency_key: obligationKey,
});

const settlementArgs = {
  contactId: 'c1',
  currency: 'CUP',
  flow: 'cash_received',
  mode: 'fifo',
  totalAmountMinor: '5000',
  requestedAllocations: [],
};
nextResult = { data: { data: { preview_fingerprint: 'a'.repeat(64), overage_minor: '0' } }, error: null };
const preview = await previewSettlement(settlementArgs);
assert.equal(preview.preview_fingerprint, 'a'.repeat(64));
lastCall('preview_settlement', {
  p_contact_id: 'c1',
  p_currency_code: 'CUP',
  p_flow: 'cash_received',
  p_mode: 'fifo',
  p_total_amount_minor: '5000',
  p_requested_allocations: [],
});

const commitArgs = {
  ...settlementArgs,
  previewFingerprint: 'a'.repeat(64),
  confirmOverage: false,
  idempotencyKey: 'settlement-idempotency-01',
};
nextResult = { data: { data: { event_id: 'e1' } }, error: null };
assert.deepEqual(await receiveCash(commitArgs), { event_id: 'e1' });
lastCall('receive_cash', {
  p_contact_id: 'c1',
  p_currency_code: 'CUP',
  p_mode: 'fifo',
  p_total_amount_minor: '5000',
  p_requested_allocations: [],
  p_preview_fingerprint: 'a'.repeat(64),
  p_confirm_overage: false,
  p_idempotency_key: 'settlement-idempotency-01',
});

nextResult = { data: { data: { event_id: 'e2' } }, error: null };
assert.deepEqual(await payContact({
  ...commitArgs,
  flow: 'cash_paid',
}), { event_id: 'e2' });
lastCall('pay_contact', {
  p_contact_id: 'c1',
  p_currency_code: 'CUP',
  p_mode: 'fifo',
  p_total_amount_minor: '5000',
  p_requested_allocations: [],
  p_preview_fingerprint: 'a'.repeat(64),
  p_confirm_overage: false,
  p_idempotency_key: 'settlement-idempotency-01',
});

const callsBeforeMissingSession = calls.length;
session = null;
await assert.rejects(
  () => listContacts(),
  (error) => error instanceof FortunaApiError && error.code === 'AUTH_REQUIRED',
);
assert.equal(calls.length, callsBeforeMissingSession, 'No request may be sent without the owner JWT');

session = { access_token: 'test-user-jwt-never-sent-to-network' };
nextError = {
  context: new Response(JSON.stringify({ error: 'IDEMPOTENCY_CONFLICT' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  }),
};
await assert.rejects(
  () => createContact({
    displayName: 'María',
    idempotencyKey: contactKey,
  }),
  (error) => error instanceof FortunaApiError
    && error.code === 'IDEMPOTENCY_CONFLICT'
    && error.status === 409,
);

await assert.rejects(
  () => listObligations('', null, null),
  (error) => error instanceof FortunaApiError && error.code === 'INVALID_ARGUMENTS',
);

nextResult = { data: { data: [{ contact_id: 'c2', display_name: 'Bad', currencies: [{ currency: 'CUP', te_debe_minor: '-1', le_debes_minor: '0' }] }] }, error: null };
await assert.rejects(
  () => listContacts(),
  (error) => error instanceof FortunaApiError && error.code === 'INVALID_RESPONSE',
);

nextError = {
  context: new Response(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  }),
};
await assert.rejects(
  () => listContacts(),
  (error) => error instanceof FortunaApiError && error.code === 'SERVICE_UNAVAILABLE' && error.retryable === true,
);

console.log('PASS — authenticated dispatcher client: caller JWT, allowlisted contact/obligation/settlement operations, exact args, secure idempotency keys, missing-session rejection and HTTP 409 mapping.');
