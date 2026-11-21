import assert from 'node:assert/strict';

const pow10 = (scale) => 10n ** BigInt(scale);

function parseMinorUnits(value, scale) {
  assert.equal(typeof value, 'string', 'Amounts must cross the API as decimal strings');
  assert.ok(Number.isInteger(scale) && scale >= 0 && scale <= 6, 'Unsupported currency precision');
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  assert.ok(match, 'Amount must be a non-negative plain decimal string');
  const fraction = match[2] || '';
  assert.ok(fraction.length <= scale, 'Amount exceeds the currency precision');
  const whole = BigInt(match[1]);
  const fractional = BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
  const result = whole * pow10(scale) + fractional;
  assert.ok(result > 0n, 'Amount must be greater than zero');
  return result;
}

function openingLine(direction, amountMinor) {
  assert.ok(amountMinor > 0n, 'Opening amount must be positive');
  if (direction === 'receivable') return amountMinor;
  if (direction === 'payable') return -amountMinor;
  throw new Error('Unknown obligation direction');
}

function validateObligation(item, contactId, currency) {
  assert.equal(item.contactId, contactId, 'Allocation cannot cross contacts');
  assert.equal(item.currency, currency, 'Allocation cannot cross currencies');
  assert.ok(item.remainingMinor > 0n, 'Only open obligations can receive an allocation');
  assert.ok(item.direction === 'receivable' || item.direction === 'payable', 'Invalid obligation direction');
}

function buildFifoSettlementPreview({ contactId, currency, flow, amountMinor, obligations }) {
  assert.ok(flow === 'cash_received' || flow === 'cash_paid', 'Unknown cash-flow direction');
  assert.ok(amountMinor > 0n, 'Settlement amount must be positive');
  const eligibleDirection = flow === 'cash_received' ? 'receivable' : 'payable';
  const candidates = obligations
    .filter((item) => item.contactId === contactId && item.currency === currency && item.direction === eligibleDirection && item.remainingMinor > 0n)
    .slice()
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id));

  const allocations = [];
  let left = amountMinor;
  for (const item of candidates) {
    validateObligation(item, contactId, currency);
    const applied = item.remainingMinor < left ? item.remainingMinor : left;
    if (applied > 0n) {
      allocations.push({ obligationId: item.id, amountMinor: applied });
      left -= applied;
    }
    if (left === 0n) break;
  }

  const allocatedMinor = amountMinor - left;
  const overageMinor = left;
  return {
    contactId,
    currency,
    flow,
    totalMinor: amountMinor,
    allocatedMinor,
    overageMinor,
    overageDirection: flow === 'cash_received' ? 'payable' : 'receivable',
    allocations,
    requiresOverageConfirmation: overageMinor > 0n
  };
}

function commitSettlementPreview(preview, { confirmOverage = false } = {}) {
  if (preview.requiresOverageConfirmation && !confirmOverage) {
    throw new Error('Explicit confirmation is required for an overpayment');
  }

  const sign = preview.flow === 'cash_received' ? -1n : 1n;
  const lines = preview.allocations.map((allocation) => ({
    kind: preview.flow,
    obligationId: allocation.obligationId,
    signedMinor: sign * allocation.amountMinor
  }));

  if (preview.overageMinor > 0n) {
    lines.push({
      kind: 'overpayment_obligation_opened',
      direction: preview.overageDirection,
      obligationId: null,
      signedMinor: sign * preview.overageMinor
    });
  }

  const signedDelta = lines.reduce((sum, line) => sum + line.signedMinor, 0n);
  assert.equal(signedDelta, sign * preview.totalMinor, 'Ledger lines must reconcile to the full cash movement');
  return { lines, signedDelta };
}

function buildManualSettlementPreview({ contactId, currency, flow, amountMinor, obligations, requestedAllocations }) {
  assert.ok(flow === 'cash_received' || flow === 'cash_paid', 'Unknown cash-flow direction');
  assert.ok(amountMinor > 0n, 'Settlement amount must be positive');
  assert.ok(Array.isArray(requestedAllocations), 'Manual allocations must be an array');
  const direction = flow === 'cash_received' ? 'receivable' : 'payable';
  const byId = new Map(obligations.map((item) => [item.id, item]));
  const seen = new Set();
  let allocatedMinor = 0n;
  const allocations = [];

  for (const requested of requestedAllocations) {
    assert.ok(!seen.has(requested.obligationId), 'An obligation may appear only once in a manual allocation');
    seen.add(requested.obligationId);
    const item = byId.get(requested.obligationId);
    assert.ok(item, 'Unknown obligation in manual allocation');
    validateObligation(item, contactId, currency);
    assert.equal(item.direction, direction, 'Cash-flow direction does not match the obligation');
    assert.ok(requested.amountMinor > 0n, 'Allocation amount must be positive');
    assert.ok(requested.amountMinor <= item.remainingMinor, 'Allocation exceeds the obligation pending amount');
    allocatedMinor += requested.amountMinor;
    allocations.push({ obligationId: item.id, amountMinor: requested.amountMinor });
  }

  assert.ok(allocatedMinor <= amountMinor, 'Allocations cannot exceed the cash movement');
  const overageMinor = amountMinor - allocatedMinor;
  return {
    contactId,
    currency,
    flow,
    totalMinor: amountMinor,
    allocatedMinor,
    overageMinor,
    overageDirection: flow === 'cash_received' ? 'payable' : 'receivable',
    allocations,
    requiresOverageConfirmation: overageMinor > 0n
  };
}

function buildCompensationPreview({ contactId, currency, receivable, payable, amountMinor }) {
  assert.ok(amountMinor > 0n, 'Compensation amount must be positive');
  validateObligation(receivable, contactId, currency);
  validateObligation(payable, contactId, currency);
  assert.equal(receivable.direction, 'receivable', 'First obligation must be receivable');
  assert.equal(payable.direction, 'payable', 'Second obligation must be payable');
  const cap = receivable.remainingMinor < payable.remainingMinor
    ? receivable.remainingMinor
    : payable.remainingMinor;
  assert.ok(amountMinor <= cap, 'Compensation exceeds one of the open obligations');

  const lines = [
    { kind: 'compensation_receivable_clearance', obligationId: receivable.id, signedMinor: -amountMinor },
    { kind: 'compensation_payable_clearance', obligationId: payable.id, signedMinor: amountMinor }
  ];
  const signedDelta = lines.reduce((sum, line) => sum + line.signedMinor, 0n);
  assert.equal(signedDelta, 0n, 'Same-currency compensation must have zero net position effect');
  return { lines, signedDelta };
}

function buildReversalLine({ originalSignedMinor, alreadyReversedMinor = 0n, requestedMinor }) {
  assert.ok(originalSignedMinor !== 0n, 'Cannot reverse a zero-value line');
  assert.ok(requestedMinor > 0n, 'Reversal amount must be positive');
  const originalMagnitude = originalSignedMinor < 0n ? -originalSignedMinor : originalSignedMinor;
  assert.ok(alreadyReversedMinor >= 0n && alreadyReversedMinor <= originalMagnitude, 'Invalid previous reversal amount');
  const remainingReversible = originalMagnitude - alreadyReversedMinor;
  assert.ok(requestedMinor <= remainingReversible, 'Reversal exceeds the amount still reversible');
  const sign = originalSignedMinor > 0n ? 1n : -1n;
  return -sign * requestedMinor;
}

function classifyCurrencyPositions(positions) {
  const nonZero = positions.filter((item) => item.signedMinor !== 0n);
  const hasReceivable = nonZero.some((item) => item.signedMinor > 0n);
  const hasPayable = nonZero.some((item) => item.signedMinor < 0n);
  if (hasReceivable && hasPayable) return 'mixed-currencies';
  if (hasReceivable) return 'receivable';
  if (hasPayable) return 'payable';
  return 'settled';
}

class IdempotencyRegistry {
  constructor() {
    this.entries = new Map();
  }

  execute(key, payloadHash, operation) {
    assert.ok(key && payloadHash, 'Idempotency key and payload hash are required');
    const prior = this.entries.get(key);
    if (prior) {
      if (prior.payloadHash !== payloadHash) throw new Error('idempotency_key_conflict');
      return { replayed: true, result: prior.result };
    }
    const result = operation();
    this.entries.set(key, { payloadHash, result });
    return { replayed: false, result };
  }
}

const m = (value, scale = 2) => parseMinorUnits(value, scale);
const mkObligation = (id, direction, remaining, openedAt, currency = 'CUP', contactId = 'contact-1') => ({
  id,
  contactId,
  currency,
  direction,
  remainingMinor: m(remaining),
  openedAt
});

// Decimal parsing is exact and currency precision is explicit.
assert.equal(m('125.40'), 12540n);
assert.equal(m('1.234', 3), 1234n);
assert.throws(() => m('1.234', 2), /currency precision/);
assert.throws(() => m('1e3'), /plain decimal/);
assert.throws(() => m('0'), /greater than zero/);
assert.equal(openingLine('receivable', m('25')), 2500n);
assert.equal(openingLine('payable', m('25')), -2500n);

// FIFO is oldest first and allocates only to the direction matching the cash flow.
const openItems = [
  mkObligation('newer', 'receivable', '50.00', '2026-02-01'),
  mkObligation('older', 'receivable', '40.00', '2026-01-01'),
  mkObligation('payable', 'payable', '70.00', '2026-01-02')
];
const fifoPreview = buildFifoSettlementPreview({
  contactId: 'contact-1', currency: 'CUP', flow: 'cash_received',
  amountMinor: m('70.00'), obligations: openItems
});
assert.deepEqual(fifoPreview.allocations, [
  { obligationId: 'older', amountMinor: m('40.00') },
  { obligationId: 'newer', amountMinor: m('30.00') }
]);
assert.equal(fifoPreview.overageMinor, 0n);
assert.equal(commitSettlementPreview(fifoPreview).signedDelta, -m('70.00'));

// Preview and cancelled overpayment confirmation do not mutate source obligations.
const receivableSource = mkObligation('receivable', 'receivable', '100.00', '2026-01-01');
const receiveOverage = buildFifoSettlementPreview({
  contactId: 'contact-1', currency: 'CUP', flow: 'cash_received',
  amountMinor: m('120.00'), obligations: [receivableSource]
});
assert.equal(receiveOverage.overageMinor, m('20.00'));
assert.equal(receiveOverage.overageDirection, 'payable');
assert.throws(() => commitSettlementPreview(receiveOverage), /Explicit confirmation/);
assert.equal(receivableSource.remainingMinor, m('100.00'));
const receivedCommit = commitSettlementPreview(receiveOverage, { confirmOverage: true });
assert.deepEqual(receivedCommit.lines.map((line) => line.signedMinor), [-m('100.00'), -m('20.00')]);
assert.equal(receivedCommit.signedDelta, -m('120.00'));

// Partial and complete payments, plus the opposite-direction overpayment rule.
const partial = buildFifoSettlementPreview({
  contactId: 'contact-1', currency: 'CUP', flow: 'cash_received',
  amountMinor: m('30.00'), obligations: [mkObligation('r', 'receivable', '100.00', '2026-01-01')]
});
assert.equal(partial.allocatedMinor, m('30.00'));
assert.equal(commitSettlementPreview(partial).signedDelta, -m('30.00'));
const full = buildFifoSettlementPreview({
  contactId: 'contact-1', currency: 'CUP', flow: 'cash_paid',
  amountMinor: m('100.00'), obligations: [mkObligation('p-full', 'payable', '100.00', '2026-01-01')]
});
assert.equal(full.overageMinor, 0n);
assert.equal(commitSettlementPreview(full).signedDelta, m('100.00'));

const payOverage = buildFifoSettlementPreview({
  contactId: 'contact-1', currency: 'CUP', flow: 'cash_paid',
  amountMinor: m('120.00'), obligations: [mkObligation('payable', 'payable', '100.00', '2026-01-01')]
});
assert.equal(payOverage.overageMinor, m('20.00'));
assert.equal(payOverage.overageDirection, 'receivable');
assert.throws(() => commitSettlementPreview(payOverage), /Explicit confirmation/);
const paidCommit = commitSettlementPreview(payOverage, { confirmOverage: true });
assert.deepEqual(paidCommit.lines.map((line) => line.signedMinor), [m('100.00'), m('20.00')]);
assert.equal(paidCommit.signedDelta, m('120.00'));

const noOpenReceivable = buildFifoSettlementPreview({
  contactId: 'contact-1', currency: 'CUP', flow: 'cash_received',
  amountMinor: m('15.00'), obligations: []
});
assert.equal(noOpenReceivable.allocatedMinor, 0n);
assert.equal(noOpenReceivable.overageMinor, m('15.00'));
assert.equal(commitSettlementPreview(noOpenReceivable, { confirmOverage: true }).signedDelta, -m('15.00'));

// Manual allocation is bounded by amount, contact, currency, direction and open balance.
const manual = buildManualSettlementPreview({
  contactId: 'contact-1', currency: 'CUP', flow: 'cash_paid',
  amountMinor: m('30.00'),
  obligations: [mkObligation('p1', 'payable', '80.00', '2026-01-01')],
  requestedAllocations: [{ obligationId: 'p1', amountMinor: m('30.00') }]
});
assert.equal(manual.overageMinor, 0n);
assert.throws(() => buildManualSettlementPreview({
  contactId: 'contact-1', currency: 'CUP', flow: 'cash_paid',
  amountMinor: m('20.00'),
  obligations: [mkObligation('r1', 'receivable', '80.00', '2026-01-01')],
  requestedAllocations: [{ obligationId: 'r1', amountMinor: m('20.00') }]
}), /direction does not match/);
assert.throws(() => buildManualSettlementPreview({
  contactId: 'contact-1', currency: 'CUP', flow: 'cash_paid',
  amountMinor: m('20.00'),
  obligations: [mkObligation('p1', 'payable', '80.00', '2026-01-01')],
  requestedAllocations: [{ obligationId: 'p1', amountMinor: m('90.00') }]
}), /exceeds the obligation/);
assert.throws(() => buildManualSettlementPreview({
  contactId: 'contact-1', currency: 'CUP', flow: 'cash_paid',
  amountMinor: m('20.00'),
  obligations: [mkObligation('p1', 'payable', '80.00', '2026-01-01', 'CUP', 'other-contact')],
  requestedAllocations: [{ obligationId: 'p1', amountMinor: m('20.00') }]
}), /cannot cross contacts/);

// Compensation clears both sides only for one contact and one currency.
const comp = buildCompensationPreview({
  contactId: 'contact-1', currency: 'CUP',
  receivable: mkObligation('r1', 'receivable', '100.00', '2026-01-01'),
  payable: mkObligation('p1', 'payable', '60.00', '2026-01-02'),
  amountMinor: m('60.00')
});
assert.deepEqual(comp.lines.map((line) => line.signedMinor), [-m('60.00'), m('60.00')]);
assert.equal(comp.signedDelta, 0n);
assert.throws(() => buildCompensationPreview({
  contactId: 'contact-1', currency: 'CUP',
  receivable: mkObligation('r1', 'receivable', '100.00', '2026-01-01', 'CUP'),
  payable: mkObligation('p1', 'payable', '60.00', '2026-01-02', 'USD'),
  amountMinor: m('10.00')
}), /cannot cross currencies/);
assert.throws(() => buildCompensationPreview({
  contactId: 'contact-1', currency: 'CUP',
  receivable: mkObligation('r1', 'receivable', '100.00', '2026-01-01'),
  payable: mkObligation('p1', 'payable', '60.00', '2026-01-02', 'CUP', 'other-contact'),
  amountMinor: m('10.00')
}), /cannot cross contacts/);
assert.throws(() => buildCompensationPreview({
  contactId: 'contact-1', currency: 'CUP',
  receivable: mkObligation('r1', 'receivable', '100.00', '2026-01-01'),
  payable: mkObligation('p1', 'payable', '60.00', '2026-01-02'),
  amountMinor: m('70.00')
}), /exceeds one of the open obligations/);

// Reversals are linked inverse lines and cannot exceed the amount still reversible.
const originalLine = -m('50.00');
assert.equal(buildReversalLine({ originalSignedMinor: originalLine, requestedMinor: m('20.00') }), m('20.00'));
assert.equal(buildReversalLine({ originalSignedMinor: originalLine, alreadyReversedMinor: m('20.00'), requestedMinor: m('30.00') }), m('30.00'));
assert.throws(() => buildReversalLine({
  originalSignedMinor: originalLine, alreadyReversedMinor: m('20.00'), requestedMinor: m('31.00')
}), /still reversible/);
assert.throws(() => buildReversalLine({
  originalSignedMinor: originalLine, alreadyReversedMinor: m('50.00'), requestedMinor: m('1.00')
}), /still reversible/);

// Mixed currencies remain separate; no cross-currency arithmetic is performed.
assert.equal(classifyCurrencyPositions([
  { currency: 'USD', signedMinor: m('20.00') },
  { currency: 'CUP', signedMinor: -m('500.00') }
]), 'mixed-currencies');
assert.equal(classifyCurrencyPositions([{ currency: 'USD', signedMinor: m('20.00') }]), 'receivable');
assert.equal(classifyCurrencyPositions([{ currency: 'CUP', signedMinor: -m('20.00') }]), 'payable');
assert.equal(classifyCurrencyPositions([{ currency: 'CUP', signedMinor: 0n }]), 'settled');

// Idempotent replay returns the first result; key reuse with another payload is rejected.
const registry = new IdempotencyRegistry();
let writes = 0;
const first = registry.execute('event-1', 'hash-A', () => ({ eventId: 'created-1', write: ++writes }));
const replay = registry.execute('event-1', 'hash-A', () => ({ eventId: 'should-not-create', write: ++writes }));
assert.equal(first.replayed, false);
assert.equal(replay.replayed, true);
assert.deepEqual(replay.result, first.result);
assert.equal(writes, 1);
assert.throws(() => registry.execute('event-1', 'hash-B', () => ++writes), /idempotency_key_conflict/);
assert.equal(writes, 1);

// No part of this reference model accesses Supabase, writes real rows or changes CuevaCoin balances.
console.log('PASS — exact currency precision and positive amount validation');
console.log('PASS — receivable/payable sign conventions');
console.log('PASS — FIFO and manual allocations remain bounded');
console.log('PASS — partial/full settlements and confirmed overpayments');
console.log('PASS — compensation is same-contact, same-currency and net-zero');
console.log('PASS — reversals are linked inverse lines and bounded');
console.log('PASS — mixed currencies remain separate');
console.log('PASS — idempotency replay and payload-conflict protection');
console.log('PASS — pure contract test performs no network or financial writes');
