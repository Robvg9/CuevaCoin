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

const aContacts = await dispatch(ownerA.token, 'list_contacts', {})
const bContacts = await dispatch(ownerB.token, 'list_contacts', {})
assert.equal(aContacts.response.status, 200)
assert.equal(bContacts.response.status, 200)
assert.deepEqual(aContacts.body?.data?.map((row) => row.contact_id), [ownerAContactId], 'Owner A must not see Owner B contact.')
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

console.log('PASS — Auth minted two local user JWTs; gateway rejected missing/invalid JWT; owner A/B isolation held; write retries replayed original IDs; changed payload returned HTTP 409; cross-owner reads/writes were rejected.')
