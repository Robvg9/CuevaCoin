import assert from 'node:assert/strict';
import {
  FortunaApiError,
  createContact,
  createIdempotencyKey,
  listContacts,
  listObligations,
  listActivity,
  openObligation,
  previewSettlement,
  receiveCash,
  payContact,
  searchFortunaProfiles,
  linkFortunaProfileContact,
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

const activityPage = {
  items: [{
    event_id: 'e-history-1',
    event_type: 'cash_received',
    currency: 'CUP',
    total_amount_minor: '5000',
    occurred_at: '2026-11-23T18:00:00.000Z',
    reversal_reason: null,
    audit_action: 'cash_received',
    ledger_entries: [{
      obligation_id: 'o1',
      description: 'Préstamo',
      amount_minor: '5000',
      entry_kind: 'cash_received',
    }],
  }],
  has_more: true,
  next_cursor: { event_id: 'e-history-1', occurred_at: '2026-11-23T18:00:00.000Z' },
};
nextResult = { data: { data: activityPage }, error: null };
assert.deepEqual(await listActivity('c1', { limit: 1 }), activityPage);
lastCall('list_activity', {
  p_contact_id: 'c1',
  p_limit: 1,
  p_before_occurred_at: null,
  p_before_event_id: null,
});
nextResult = { data: { data: { ...activityPage, has_more: true, next_cursor: null } }, error: null };
await assert.rejects(
  () => listActivity('c1'),
  (error) => error instanceof FortunaApiError && error.code === 'INVALID_RESPONSE',
);
await assert.rejects(
  () => listActivity('c1', { limit: 101 }),
  (error) => error instanceof FortunaApiError && error.code === 'INVALID_ARGUMENTS',
);

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
const validPreview = {
  version: 1,
  book_id: 'book-1',
  contact_id: 'c1',
  currency: 'CUP',
  flow: 'cash_received',
  mode: 'fifo',
  total_amount_minor: '5000',
  eligible_obligations: [{
    obligation_id: 'o1',
    opened_at: '2026-01-01T00:00:00Z',
    remaining_minor: '10000',
  }],
  allocations: [{ obligation_id: 'o1', amount_minor: '5000' }],
  allocated_minor: '5000',
  overage_minor: '0',
  overage_direction: null,
  preview_fingerprint: 'a'.repeat(64),
};
nextResult = { data: { data: validPreview }, error: null };
const preview = await previewSettlement(settlementArgs);
assert.equal(preview.preview_fingerprint, 'a'.repeat(64));
assert.deepEqual(preview.allocations, [{ obligation_id: 'o1', amount_minor: '5000' }]);
lastCall('preview_settlement', {
  p_contact_id: 'c1',
  p_currency_code: 'CUP',
  p_flow: 'cash_received',
  p_mode: 'fifo',
  p_total_amount_minor: '5000',
  p_requested_allocations: [],
});

nextResult = { data: { data: { ...validPreview, allocated_minor: '4000' } }, error: null };
await assert.rejects(
  () => previewSettlement(settlementArgs),
  (error) => error instanceof FortunaApiError && error.code === 'INVALID_RESPONSE',
);

const manualArgs = {
  ...settlementArgs,
  mode: 'manual',
  totalAmountMinor: '2500',
  requestedAllocations: [{ obligation_id: 'o1', amount_minor: '2500' }],
};
const manualPreview = {
  ...validPreview,
  mode: 'manual',
  total_amount_minor: '2500',
  allocations: [{ obligation_id: 'o1', amount_minor: '2500' }],
  allocated_minor: '2500',
  overage_minor: '0',
  overage_direction: null,
  preview_fingerprint: 'b'.repeat(64),
};
nextResult = { data: { data: { ...validPreview, contact_id: 'another-contact' } }, error: null };
await assert.rejects(
  () => previewSettlement(settlementArgs),
  (error) => error instanceof FortunaApiError && error.code === 'INVALID_RESPONSE',
);
nextResult = { data: { data: manualPreview }, error: null };
assert.equal((await previewSettlement(manualArgs)).mode, 'manual');
lastCall('preview_settlement', {
  p_contact_id: 'c1',
  p_currency_code: 'CUP',
  p_flow: 'cash_received',
  p_mode: 'manual',
  p_total_amount_minor: '2500',
  p_requested_allocations: [{ obligation_id: 'o1', amount_minor: '2500' }],
});

const invalidFifoPreview = {
  ...validPreview,
  eligible_obligations: [
    { obligation_id: 'o1', opened_at: '2026-01-01T00:00:00Z', remaining_minor: '5000' },
    { obligation_id: 'o2', opened_at: '2026-01-02T00:00:00Z', remaining_minor: '5000' },
  ],
  allocations: [
    { obligation_id: 'o2', amount_minor: '2500' },
    { obligation_id: 'o1', amount_minor: '2500' },
  ],
  allocated_minor: '5000',
};
nextResult = { data: { data: invalidFifoPreview }, error: null };
await assert.rejects(
  () => previewSettlement(settlementArgs),
  (error) => error instanceof FortunaApiError && error.code === 'INVALID_RESPONSE',
);

const overagePreview = {
  ...validPreview,
  total_amount_minor: '15000',
  allocated_minor: '10000',
  overage_minor: '5000',
  overage_direction: 'payable',
  allocations: [{ obligation_id: 'o1', amount_minor: '10000' }],
};
nextResult = { data: { data: overagePreview }, error: null };
assert.equal((await previewSettlement({ ...settlementArgs, totalAmountMinor: '15000' })).overage_direction, 'payable');
lastCall('preview_settlement', {
  p_contact_id: 'c1',
  p_currency_code: 'CUP',
  p_flow: 'cash_received',
  p_mode: 'fifo',
  p_total_amount_minor: '15000',
  p_requested_allocations: [],
});

const commitArgs = {
  ...settlementArgs,
  previewFingerprint: 'a'.repeat(64),
  confirmOverage: false,
  idempotencyKey: 'settlement-idempotency-01',
};
const validCommit = {
  event_id: 'e1',
  flow: 'cash_received',
  mode: 'fifo',
  currency: 'CUP',
  total_amount_minor: '5000',
  allocated_minor: '5000',
  overage_minor: '0',
  allocations: [{ obligation_id: 'o1', amount_minor: '5000' }],
  overage_obligation_id: null,
};
await assert.rejects(
  () => receiveCash({ ...commitArgs, previewFingerprint: 'not-a-fingerprint' }),
  (error) => error instanceof FortunaApiError && error.code === 'INVALID_ARGUMENTS',
);
nextResult = { data: { data: { ...validCommit, total_amount_minor: '6000' } }, error: null };
await assert.rejects(
  () => receiveCash(commitArgs),
  (error) => error instanceof FortunaApiError && error.code === 'INVALID_RESPONSE',
);
nextResult = { data: { data: validCommit }, error: null };
assert.deepEqual(await receiveCash(commitArgs), validCommit);
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

const overageCommit = {
  ...validCommit,
  event_id: 'e-overage',
  total_amount_minor: '15000',
  allocated_minor: '10000',
  overage_minor: '5000',
  allocations: [{ obligation_id: 'o1', amount_minor: '10000' }],
  overage_obligation_id: 'new-obligation',
};
nextResult = { data: { data: overageCommit }, error: null };
assert.deepEqual(await receiveCash({
  ...commitArgs,
  totalAmountMinor: '15000',
  confirmOverage: true,
}), overageCommit);
lastCall('receive_cash', {
  p_contact_id: 'c1',
  p_currency_code: 'CUP',
  p_mode: 'fifo',
  p_total_amount_minor: '15000',
  p_requested_allocations: [],
  p_preview_fingerprint: 'a'.repeat(64),
  p_confirm_overage: true,
  p_idempotency_key: 'settlement-idempotency-01',
});

const validPayCommit = { ...validCommit, event_id: 'e2', flow: 'cash_paid' };
nextResult = { data: { data: validPayCommit }, error: null };
assert.deepEqual(await payContact({
  ...commitArgs,
  flow: 'cash_paid',
}), validPayCommit);
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

nextError = {
  context: new Response(JSON.stringify({ error: 'STALE_PREVIEW' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  }),
};
await assert.rejects(
  () => receiveCash(commitArgs),
  (error) => error instanceof FortunaApiError && error.code === 'STALE_PREVIEW' && error.status === 409,
);

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

nextResult = { data: { data: [{ profile_id: 'profile-2', username: 'maria', display_name: 'María Pérez' }] }, error: null };
assert.deepEqual(await searchFortunaProfiles('mar'), [{ profile_id: 'profile-2', username: 'maria', display_name: 'María Pérez' }]);
lastCall('search_fortuna_profiles', { p_query: 'mar' });
nextResult = { data: { data: { contact_id: 'contact-linked', display_name: 'María Pérez', username: 'maria', linked_profile_id: 'profile-2', is_dependent: false, is_new_contact: true, balance_minor: '0' } }, error: null };
assert.equal((await linkFortunaProfileContact('profile-2')).contact_id, 'contact-linked');
lastCall('link_fortuna_profile_contact', { p_profile_id: 'profile-2', p_is_dependent: false });
nextResult = { data: { data: { contact_id: 'contact-linked', display_name: 'María Pérez', username: 'maria', linked_profile_id: 'profile-2', is_dependent: true, is_new_contact: false, balance_minor: '0' } }, error: null };
assert.equal((await linkFortunaProfileContact('profile-2', true)).is_dependent, true);
lastCall('link_fortuna_profile_contact', { p_profile_id: 'profile-2', p_is_dependent: true });
await assert.rejects(() => searchFortunaProfiles('x'), (error) => error.code === 'INVALID_ARGUMENTS');
await assert.rejects(() => linkFortunaProfileContact(''), (error) => error.code === 'INVALID_ARGUMENTS');

console.log('PASS — authenticated dispatcher client: caller JWT, allowlisted operations, schema-validated settlement plans and commits, overage direction, stale-preview HTTP 409, secure idempotency and session guards.');
