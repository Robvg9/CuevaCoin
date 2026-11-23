import assert from 'node:assert/strict'

const SUPABASE_URL = 'https://zqgmjwfvluboiporytcq.supabase.co'
const PUBLISHABLE_API_KEY = 'sb_publishable_fyqk_L78-Kv--pmzbIsqPw_iWFjVLug'

// This is a public client key, not a user JWT or service-role secret.
// Intentionally omit Authorization: verify_jwt=true must reject at the Edge gateway.
const response = await fetch(`${SUPABASE_URL}/functions/v1/fortuna-dispatch`, {
  method: 'POST',
  headers: {
    apikey: PUBLISHABLE_API_KEY,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ operation: 'list_contacts', args: {} }),
})

const responseBody = await response.text()
assert.equal(
  response.status,
  401,
  `Expected Edge gateway to reject a request without a user JWT; received HTTP ${response.status}: ${responseBody.slice(0, 300)}`,
)
assert.doesNotMatch(
  responseBody,
  /AUTH_REQUIRED/i,
  'The application handler ran; this smoke test expects the verify_jwt gateway to reject the request first.',
)

console.log('PASS — hosted fortuna-dispatch gateway rejected a request with public apikey but no user JWT')
