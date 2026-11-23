import assert from 'node:assert/strict'

const SUPABASE_URL = 'https://zqgmjwfvluboiporytcq.supabase.co'
const PUBLISHABLE_API_KEY = 'sb_publishable_fyqk_L78-Kv--pmzbIsqPw_iWFjVLug'
const ENDPOINT = `${SUPABASE_URL}/functions/v1/fortuna-dispatch`

async function invoke(headers) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_API_KEY,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ operation: 'list_contacts', args: {} }),
  })
}

// Public project API key without a user JWT. The application handler must stop
// this request with AUTH_REQUIRED before auth.getUser() or any RPC can run.
const missingJwt = await invoke({})
const missingBody = await missingJwt.text()
assert.equal(
  missingJwt.status,
  401,
  `Expected missing user JWT to be rejected with HTTP 401; got ${missingJwt.status}: ${missingBody.slice(0, 300)}`,
)
assert.match(
  missingBody,
  /AUTH_REQUIRED/,
  `Expected the explicit handler guard AUTH_REQUIRED; got: ${missingBody.slice(0, 300)}`,
)

// A malformed bearer value must also be rejected with 401. Supabase may reject
// it at the gateway or the handler's auth.getUser() check; neither may succeed.
const invalidJwt = await invoke({ Authorization: 'Bearer invalid-test-token' })
const invalidBody = await invalidJwt.text()
assert.equal(
  invalidJwt.status,
  401,
  `Expected malformed user JWT to be rejected with HTTP 401; got ${invalidJwt.status}: ${invalidBody.slice(0, 300)}`,
)
assert.doesNotMatch(
  invalidBody,
  /"data"\s*:/,
  'Malformed user JWT must never receive a successful RPC response.',
)

console.log('PASS — fortuna-dispatch rejects missing and malformed user JWTs (401); no RPC success')
