import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

const baseUrl = process.env.FORTUNA_E2E_URL
const apiKey = process.env.FORTUNA_E2E_API_KEY
assert.ok(baseUrl, 'FORTUNA_E2E_URL must point to the local Supabase stack')
assert.ok(apiKey, 'FORTUNA_E2E_API_KEY must be the local publishable/anon key')

const root = baseUrl.replace(/\/$/, '')
const endpoint = `${root}/functions/v1/fortuna-dispatch`
const authUrl = `${root}/auth/v1`

async function readJson(response) {
  const raw = await response.text()
  try { return raw ? JSON.parse(raw) : null }
  catch { return { raw: raw.slice(0, 300) } }
}

async function dispatch(accessToken, operation, args) {
  const headers = { apikey: apiKey, 'content-type': 'application/json' }
  if (accessToken) headers.authorization = `Bearer ${accessToken}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ operation, args }),
  })
  return { response, body: await readJson(response) }
}

async function createTestOwner(label) {
  const email = `fortuna-${label}-${randomUUID()}@example.com`
  const password = `F0rtuna!${randomBytes(24).toString('base64url')}aA1`
  const response = await fetch(`${authUrl}/signup`, {
    method: 'POST',
    headers: { apikey: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, data: { e2e: true, owner: label } }),
  })
  const body = await readJson(response)
  assert.equal(response.status, 200, `Local Auth signup for ${label} failed with HTTP ${response.status}: ${JSON.stringify(body).slice(0, 350)}`)
  const token = body?.access_token ?? body?.session?.access_token
  assert.ok(token, `Local Auth did not return a session for ${label}; local email confirmation must be disabled.`)
  assert.ok(body?.user?.id, `Local Auth did not return a user id for ${label}.`)
  return { id: body.user.id, token }
}

// The real local gateway must reject both missing and malformed user JWTs.
const missingJwt = await dispatch(null, 'list_contacts', {})
assert.equal(missingJwt.response.status, 401, `Missing JWT must return HTTP 401: ${JSON.stringify(missingJwt.body)}`)

const invalidJwtResponse = await fetch(endpoint, {
  method: 'POST',
  headers: {
    apikey: apiKey,
    authorization: 'Bearer invalid-local-test-token',
    'content-type': 'application/json',
  },
  body: JSON.stringify({ operation: 'list_contacts', args: {} }),
})
const invalidJwtBody = await readJson(invalidJwtResponse)
assert.equal(invalidJwtResponse.status, 401, `Malformed JWT must return HTTP 401: ${JSON.stringify(invalidJwtBody)}`)

// These identities exist only in the disposable local Auth database.
const ownerA = await createTestOwner('owner-a')
const ownerB = await createTestOwner('owner-b')

// Owner A creates a contact. A same-key/same-payload retry returns the same id.
const contactKey = randomUUID()
const ownerAContactArgs = {
  p_display_name: `E2E Owner A ${randomUUID().slice(0, 8)}`,
  p_phone: null,
  p_notes: 'ephemeral authenticated local E2E fixture',
  p_idempotency_key: contactKey,
}
const firstContact = await dispatch(ownerA.token, 'create_contact', ownerAContactArgs)
assert.equal(firstContact.response.status, 200, `Owner A create_contact failed: ${JSON.stringify(firstContact.body)}`)
const replayContact = await dispatch(ownerA.token, 'create_contact', ownerAContactArgs)
assert.equal(replayContact.response.status, 200, `Owner A contact replay failed: ${JSON.stringify(replayContact.body)}`)
const ownerAContactId = firstContact.body?.data?.contact_id
assert.ok(ownerAContactId, 'Owner A create_contact response omitted contact_id.')
assert.equal(replayContact.body?.data?.contact_id, ownerAContactId, 'Contact replay did not return the original id.')

// A manual FORTUNA contact has no linked CuevaCoin source and must never
// be treated as a migration candidate.
const unlinkedHistoryPreview = await dispatch(ownerA.token, 'preview_fortuna_profile_history_migration', {
  p_contact_id: ownerAContactId,
})
assert.equal(unlinkedHistoryPreview.response.status, 400)
assert.equal(unlinkedHistoryPreview.body?.error, 'FORTUNA_OPERATION_REJECTED')
assert.equal(unlinkedHistoryPreview.body?.data, undefined, 'An unlinked contact must not leak CuevaCoin profile details through the migration preview.')


// Reusing a key with a changed payload must be translated to HTTP 409.
const conflict = await dispatch(ownerA.token, 'create_contact', {
  ...ownerAContactArgs,
  p_display_name: `${ownerAContactArgs.p_display_name} changed`,
})
assert.equal(conflict.response.status, 409, `Changed idempotency payload must return HTTP 409: ${JSON.stringify(conflict.body)}`)
assert.equal(conflict.body?.error, 'IDEMPOTENCY_CONFLICT')

// Owner B cannot see A's book before creating its own contact.
const emptyB = await dispatch(ownerB.token, 'list_contacts', {})
assert.equal(emptyB.response.status, 200, `Owner B list_contacts failed: ${JSON.stringify(emptyB.body)}`)
assert.deepEqual(emptyB.body?.data, [], 'A fresh owner must not see Owner A contacts.')

const bContact = await dispatch(ownerB.token, 'create_contact', {
  p_display_name: `E2E Owner B ${randomUUID().slice(0, 8)}`,
  p_phone: null,
  p_notes: 'separate owner fixture',
  p_idempotency_key: randomUUID(),
})
assert.equal(bContact.response.status, 200, `Owner B create_contact failed: ${JSON.stringify(bContact.body)}`)
const ownerBContactId = bContact.body?.data?.contact_id
assert.ok(ownerBContactId, 'Owner B create_contact response omitted contact_id.')
assert.notEqual(ownerBContactId, ownerAContactId)

// Owner A opens one receivable; retrying it must return the same financial event.
const obligationArgs = {
  p_contact_id: ownerAContactId,
  p_direction: 'receivable',
  p_currency_code: 'CUP',
  p_amount_minor: '12500',
  p_description: 'Local E2E only — no production financial record',
  p_due_at: null,
  p_idempotency_key: randomUUID(),
}
const firstObligation = await dispatch(ownerA.token, 'open_obligation', obligationArgs)
assert.equal(firstObligation.response.status, 200, `Owner A open_obligation failed: ${JSON.stringify(firstObligation.body)}`)
const replayObligation = await dispatch(ownerA.token, 'open_obligation', obligationArgs)
assert.equal(replayObligation.response.status, 200, `Owner A obligation replay failed: ${JSON.stringify(replayObligation.body)}`)
const eventId = firstObligation.body?.data?.event_id
assert.ok(eventId, 'Owner A open_obligation response omitted event_id.')
assert.equal(replayObligation.body?.data?.event_id, eventId, 'Financial replay did not return the original event id.')

const ownerAObligations = await dispatch(ownerA.token, 'list_obligations', {
  p_contact_id: ownerAContactId,
  p_currency_code: 'CUP',
  p_direction: 'receivable',
})
assert.equal(ownerAObligations.response.status, 200, `Owner A list_obligations failed: ${JSON.stringify(ownerAObligations.body)}`)
assert.equal(ownerAObligations.body?.data?.length, 1, 'Idempotent replay must leave exactly one obligation.')

// Exercise the full settlement route through local Auth → Edge → PostgREST → SQL.
const fifoPreviewResponse = await dispatch(ownerA.token, 'preview_settlement', {
  p_contact_id: ownerAContactId,
  p_currency_code: 'CUP',
  p_flow: 'cash_received',
  p_mode: 'fifo',
  p_total_amount_minor: '5000',
  p_requested_allocations: [],
})
assert.equal(fifoPreviewResponse.response.status, 200)
const fifoPlan = fifoPreviewResponse.body?.data
assert.equal(fifoPlan?.contact_id, ownerAContactId)
assert.equal(fifoPlan?.flow, 'cash_received')
assert.equal(fifoPlan?.mode, 'fifo')
assert.equal(fifoPlan?.total_amount_minor, '5000')
assert.equal(fifoPlan?.allocated_minor, '5000')
assert.equal(fifoPlan?.overage_minor, '0')
assert.equal(fifoPlan?.overage_direction, null)
assert.match(fifoPlan?.preview_fingerprint || '', /^[0-9a-f]{64}$/)
assert.deepEqual(
  fifoPlan.allocations.map((item) => [item.obligation_id, item.amount_minor]),
  [[ownerAObligations.body.data[0].obligation_id, '5000']],
)

const fifoCommitArgs = {
  p_contact_id: ownerAContactId,
  p_currency_code: 'CUP',
  p_mode: 'fifo',
  p_total_amount_minor: '5000',
  p_requested_allocations: [],
  p_preview_fingerprint: fifoPlan.preview_fingerprint,
  p_confirm_overage: false,
  p_idempotency_key: randomUUID(),
}
const fifoCommit = await dispatch(ownerA.token, 'receive_cash', fifoCommitArgs)
assert.equal(fifoCommit.response.status, 200)
assert.ok(fifoCommit.body?.data?.event_id)
assert.equal(fifoCommit.body.data.allocated_minor, '5000')
assert.equal(fifoCommit.body.data.overage_minor, '0')
const fifoReplay = await dispatch(ownerA.token, 'receive_cash', fifoCommitArgs)
assert.equal(fifoReplay.response.status, 200)
assert.deepEqual(fifoReplay.body?.data, fifoCommit.body?.data)
const ownerAAfterFifo = await dispatch(ownerA.token, 'list_obligations', {
  p_contact_id: ownerAContactId,
  p_currency_code: 'CUP',
  p_direction: 'receivable',
})
assert.equal(ownerAAfterFifo.response.status, 200)
assert.equal(ownerAAfterFifo.body?.data?.length, 1)
assert.equal(ownerAAfterFifo.body.data[0].remaining_minor, '7500')

const firstActivityPage = await dispatch(ownerA.token, 'list_activity', {
  p_contact_id: ownerAContactId,
  p_limit: 1,
  p_before_occurred_at: null,
  p_before_event_id: null,
})
assert.equal(firstActivityPage.response.status, 200, `Owner A activity history failed: ${JSON.stringify(firstActivityPage.body)}`)
assert.equal(firstActivityPage.body?.data?.items?.length, 1)
assert.equal(firstActivityPage.body?.data?.has_more, true)
const activityCursor = firstActivityPage.body?.data?.next_cursor
assert.equal(activityCursor?.event_id, firstActivityPage.body.data.items[0].event_id)
assert.equal(activityCursor?.occurred_at, firstActivityPage.body.data.items[0].occurred_at)

const secondActivityPage = await dispatch(ownerA.token, 'list_activity', {
  p_contact_id: ownerAContactId,
  p_limit: 1,
  p_before_occurred_at: activityCursor.occurred_at,
  p_before_event_id: activityCursor.event_id,
})
assert.equal(secondActivityPage.response.status, 200)
assert.equal(secondActivityPage.body?.data?.items?.length, 1)
assert.equal(secondActivityPage.body?.data?.has_more, false)
assert.equal(secondActivityPage.body?.data?.next_cursor, null)
const contactActivity = [...firstActivityPage.body.data.items, ...secondActivityPage.body.data.items]
assert.deepEqual(
  new Set(contactActivity.map((item) => item.event_type)),
  new Set(['obligation_opened', 'cash_received']),
)
assert.ok(contactActivity.every((item) => item.currency === 'CUP' && item.ledger_entries.length === 1))
assert.ok(contactActivity.every((item) => typeof item.audit_action === 'string'))
assert.ok(contactActivity.every((item) => item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)))
assert.ok(contactActivity.some((item) => item.ledger_entries[0].description === obligationArgs.p_description))

const ownerBActivity = await dispatch(ownerB.token, 'list_activity', {
  p_contact_id: ownerBContactId,
  p_limit: 50,
  p_before_occurred_at: null,
  p_before_event_id: null,
})
assert.equal(ownerBActivity.response.status, 200)
assert.deepEqual(ownerBActivity.body?.data, { items: [], has_more: false, next_cursor: null })
const crossOwnerActivity = await dispatch(ownerB.token, 'list_activity', {
  p_contact_id: ownerAContactId,
  p_limit: 50,
  p_before_occurred_at: null,
  p_before_event_id: null,
})
assert.equal(crossOwnerActivity.response.status, 400)
assert.equal(crossOwnerActivity.body?.error, 'FORTUNA_OPERATION_REJECTED')
console.log('PASS — paginated financial history is owner-scoped, cursor-stable, includes ledger lines and audit action, and rejects cross-owner reads')
console.log('PASS — authenticated FIFO preview/confirm; exact settlement replay returned original event without duplicate balance changes')

// Manual cash-paid settlement.
const manualContact = await dispatch(ownerA.token, 'create_contact', {
  p_display_name: 'Local E2E manual settlement',
  p_phone: null,
  p_notes: 'Disposable local E2E only',
  p_idempotency_key: randomUUID(),
})
assert.equal(manualContact.response.status, 200)
const manualContactId = manualContact.body?.data?.contact_id
assert.ok(manualContactId)
const manualObligation = await dispatch(ownerA.token, 'open_obligation', {
  p_contact_id: manualContactId,
  p_direction: 'payable',
  p_currency_code: 'CUP',
  p_amount_minor: '4000',
  p_description: 'Local manual payable',
  p_due_at: null,
  p_idempotency_key: randomUUID(),
})
assert.equal(manualObligation.response.status, 200)
const manualObligationId = manualObligation.body?.data?.obligation_id
assert.ok(manualObligationId)
const manualPlanResponse = await dispatch(ownerA.token, 'preview_settlement', {
  p_contact_id: manualContactId,
  p_currency_code: 'CUP',
  p_flow: 'cash_paid',
  p_mode: 'manual',
  p_total_amount_minor: '2500',
  p_requested_allocations: [{ obligation_id: manualObligationId, amount_minor: '2500' }],
})
assert.equal(manualPlanResponse.response.status, 200)
const manualPlan = manualPlanResponse.body?.data
assert.equal(manualPlan?.flow, 'cash_paid')
assert.equal(manualPlan?.mode, 'manual')
assert.equal(manualPlan?.allocated_minor, '2500')
assert.equal(manualPlan?.overage_minor, '0')
assert.deepEqual(manualPlan?.allocations, [{ obligation_id: manualObligationId, amount_minor: '2500' }])
const manualCommit = await dispatch(ownerA.token, 'pay_contact', {
  p_contact_id: manualContactId,
  p_currency_code: 'CUP',
  p_mode: 'manual',
  p_total_amount_minor: '2500',
  p_requested_allocations: [{ obligation_id: manualObligationId, amount_minor: '2500' }],
  p_preview_fingerprint: manualPlan.preview_fingerprint,
  p_confirm_overage: false,
  p_idempotency_key: randomUUID(),
})
assert.equal(manualCommit.response.status, 200)
assert.equal(manualCommit.body?.data?.flow, 'cash_paid')
const manualRemaining = await dispatch(ownerA.token, 'list_obligations', {
  p_contact_id: manualContactId,
  p_currency_code: 'CUP',
  p_direction: 'payable',
})
assert.equal(manualRemaining.response.status, 200)
assert.equal(manualRemaining.body?.data?.length, 1)
assert.equal(manualRemaining.body.data[0].remaining_minor, '1500')
console.log('PASS — manual pay_contact preview/confirm applied only the selected payable obligation')

// An intervening settlement invalidates a previous fingerprint.
const staleContact = await dispatch(ownerA.token, 'create_contact', {
  p_display_name: 'Local E2E stale preview',
  p_phone: null,
  p_notes: 'Disposable local E2E only',
  p_idempotency_key: randomUUID(),
})
assert.equal(staleContact.response.status, 200)
const staleContactId = staleContact.body?.data?.contact_id
assert.ok(staleContactId)
const staleObligation = await dispatch(ownerA.token, 'open_obligation', {
  p_contact_id: staleContactId,
  p_direction: 'receivable',
  p_currency_code: 'CUP',
  p_amount_minor: '1000',
  p_description: 'Local stale-preview receivable',
  p_due_at: null,
  p_idempotency_key: randomUUID(),
})
assert.equal(staleObligation.response.status, 200)
const staleObligationId = staleObligation.body?.data?.obligation_id
const stalePlanResponse = await dispatch(ownerA.token, 'preview_settlement', {
  p_contact_id: staleContactId,
  p_currency_code: 'CUP',
  p_flow: 'cash_received',
  p_mode: 'fifo',
  p_total_amount_minor: '800',
  p_requested_allocations: [],
})
assert.equal(stalePlanResponse.response.status, 200)
const stalePlan = stalePlanResponse.body?.data
const interleavingPlanResponse = await dispatch(ownerA.token, 'preview_settlement', {
  p_contact_id: staleContactId,
  p_currency_code: 'CUP',
  p_flow: 'cash_received',
  p_mode: 'fifo',
  p_total_amount_minor: '200',
  p_requested_allocations: [],
})
assert.equal(interleavingPlanResponse.response.status, 200)
const interleavingPlan = interleavingPlanResponse.body?.data
const interleavingCommit = await dispatch(ownerA.token, 'receive_cash', {
  p_contact_id: staleContactId,
  p_currency_code: 'CUP',
  p_mode: 'fifo',
  p_total_amount_minor: '200',
  p_requested_allocations: [],
  p_preview_fingerprint: interleavingPlan.preview_fingerprint,
  p_confirm_overage: false,
  p_idempotency_key: randomUUID(),
})
assert.equal(interleavingCommit.response.status, 200)
const staleCommit = await dispatch(ownerA.token, 'receive_cash', {
  p_contact_id: staleContactId,
  p_currency_code: 'CUP',
  p_mode: 'fifo',
  p_total_amount_minor: '800',
  p_requested_allocations: [],
  p_preview_fingerprint: stalePlan.preview_fingerprint,
  p_confirm_overage: false,
  p_idempotency_key: randomUUID(),
})
assert.equal(staleCommit.response.status, 409)
assert.equal(staleCommit.body?.error, 'STALE_PREVIEW')
const staleRemaining = await dispatch(ownerA.token, 'list_obligations', {
  p_contact_id: staleContactId,
  p_currency_code: 'CUP',
  p_direction: 'receivable',
})
assert.equal(staleRemaining.response.status, 200)
assert.equal(staleRemaining.body?.data?.length, 1)
assert.equal(staleRemaining.body.data[0].obligation_id, staleObligationId)
assert.equal(staleRemaining.body.data[0].remaining_minor, '800')
console.log('PASS — stale fingerprint rejected with HTTP 409 and left balance unchanged')

// Excess is rejected until explicit confirmation, then opens the opposite obligation.
const overageContact = await dispatch(ownerA.token, 'create_contact', {
  p_display_name: 'Local E2E confirmed overage',
  p_phone: null,
  p_notes: 'Disposable local E2E only',
  p_idempotency_key: randomUUID(),
})
assert.equal(overageContact.response.status, 200)
const overageContactId = overageContact.body?.data?.contact_id
assert.ok(overageContactId)
const overageSource = await dispatch(ownerA.token, 'open_obligation', {
  p_contact_id: overageContactId,
  p_direction: 'receivable',
  p_currency_code: 'CUP',
  p_amount_minor: '500',
  p_description: 'Local overage source receivable',
  p_due_at: null,
  p_idempotency_key: randomUUID(),
})
assert.equal(overageSource.response.status, 200)
const overagePlanResponse = await dispatch(ownerA.token, 'preview_settlement', {
  p_contact_id: overageContactId,
  p_currency_code: 'CUP',
  p_flow: 'cash_received',
  p_mode: 'fifo',
  p_total_amount_minor: '1000',
  p_requested_allocations: [],
})
assert.equal(overagePlanResponse.response.status, 200)
const overagePlan = overagePlanResponse.body?.data
assert.equal(overagePlan?.allocated_minor, '500')
assert.equal(overagePlan?.overage_minor, '500')
assert.equal(overagePlan?.overage_direction, 'payable')
const unconfirmedOverage = await dispatch(ownerA.token, 'receive_cash', {
  p_contact_id: overageContactId,
  p_currency_code: 'CUP',
  p_mode: 'fifo',
  p_total_amount_minor: '1000',
  p_requested_allocations: [],
  p_preview_fingerprint: overagePlan.preview_fingerprint,
  p_confirm_overage: false,
  p_idempotency_key: randomUUID(),
})
assert.equal(unconfirmedOverage.response.status, 400)
assert.equal(unconfirmedOverage.body?.error, 'FORTUNA_OPERATION_REJECTED')
const confirmedOverage = await dispatch(ownerA.token, 'receive_cash', {
  p_contact_id: overageContactId,
  p_currency_code: 'CUP',
  p_mode: 'fifo',
  p_total_amount_minor: '1000',
  p_requested_allocations: [],
  p_preview_fingerprint: overagePlan.preview_fingerprint,
  p_confirm_overage: true,
  p_idempotency_key: randomUUID(),
})
assert.equal(confirmedOverage.response.status, 200)
const overageObligationId = confirmedOverage.body?.data?.overage_obligation_id
assert.ok(overageObligationId)
const createdPayable = await dispatch(ownerA.token, 'list_obligations', {
  p_contact_id: overageContactId,
  p_currency_code: 'CUP',
  p_direction: 'payable',
})
assert.equal(createdPayable.response.status, 200)
assert.equal(createdPayable.body?.data?.length, 1)
assert.equal(createdPayable.body.data[0].obligation_id, overageObligationId)
assert.equal(createdPayable.body.data[0].direction, 'payable')
assert.equal(createdPayable.body.data[0].principal_minor, '500')
assert.equal(createdPayable.body.data[0].remaining_minor, '500')
console.log('PASS — unconfirmed excess rejected; explicit confirmation created exactly one opposite payable obligation')

const aContacts = await dispatch(ownerA.token, 'list_contacts', {})
const bContacts = await dispatch(ownerB.token, 'list_contacts', {})
assert.equal(aContacts.response.status, 200)
assert.equal(bContacts.response.status, 200)
assert.ok(aContacts.body?.data?.some((row) => row.contact_id === ownerAContactId), 'Owner A must still see the original contact.')
assert.ok(!aContacts.body?.data?.some((row) => row.contact_id === ownerBContactId), 'Owner A must not see Owner B contact.')
assert.deepEqual(bContacts.body?.data?.map((row) => row.contact_id), [ownerBContactId], 'Owner B must not see Owner A contact.')

// Another owner cannot use A's contact id to create or read obligations.
const crossOwnerWrite = await dispatch(ownerB.token, 'open_obligation', {
  ...obligationArgs,
  p_contact_id: ownerAContactId,
  p_idempotency_key: randomUUID(),
})
assert.equal(crossOwnerWrite.response.status, 400, `Cross-owner write should be rejected: ${JSON.stringify(crossOwnerWrite.body)}`)
assert.equal(crossOwnerWrite.body?.error, 'FORTUNA_OPERATION_REJECTED')

const crossOwnerRead = await dispatch(ownerB.token, 'list_obligations', {
  p_contact_id: ownerAContactId,
  p_currency_code: 'CUP',
  p_direction: 'receivable',
})
assert.equal(crossOwnerRead.response.status, 400, `Cross-owner read should be rejected: ${JSON.stringify(crossOwnerRead.body)}`)
assert.equal(crossOwnerRead.body?.error, 'FORTUNA_OPERATION_REJECTED')

const aObligationsAfter = await dispatch(ownerA.token, 'list_obligations', {
  p_contact_id: ownerAContactId,
  p_currency_code: 'CUP',
  p_direction: 'receivable',
})
assert.equal(aObligationsAfter.response.status, 200)
assert.equal(aObligationsAfter.body?.data?.length, 1, 'Rejected cross-owner requests must not mutate Owner A data.')

console.log('PASS — local authenticated E2E: JWT enforcement, two-owner isolation, contact/obligation idempotency, FIFO/manual settlement, settlement replay, stale-preview HTTP 409, explicit overage confirmation and cross-owner rejection.')
