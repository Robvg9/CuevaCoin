import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../supabase/functions/fortuna-dispatch/index.ts', import.meta.url), 'utf8')
const docs = await readFile(new URL('../docs/fortuna/edge-dispatcher.md', import.meta.url), 'utf8')
const smoke = await readFile(new URL('./smoke-fortuna-dispatch-auth.mjs', import.meta.url), 'utf8')

assert.match(source, /createClient\(SUPABASE_URL, SUPABASE_PUBLIC_KEY/)
assert.match(source, /Deno\.env\.get\('SUPABASE_PUBLISHABLE_KEYS'\)/)
assert.match(source, /keys\.default/)
assert.match(source, /Deno\.env\.get\('SUPABASE_ANON_KEY'\)/)
assert.match(source, /supabase\.auth\.getUser\(accessToken\)/)
assert.match(source, /const accessToken = authHeader\.replace/)
assert.match(source, /Authorization: authHeader/)
assert.match(source, /supabase\.schema\('api'\)\.rpc\(rpc, body\.args\)/)
assert.match(source, /FORTUNA_API_SCHEMA_NOT_EXPOSED/)
assert.match(source, /PGRST202/)
assert.match(source, /MAX_BODY_BYTES/)
assert.match(source, /reader\.cancel\(\)/)
assert.match(source, /reader\.read\(\)/)
assert.match(source, /OPERATION_NOT_ALLOWED/)
assert.match(source, /Object\.hasOwn\(RPC_BY_OPERATION, body\.operation\)/)
assert.match(source, /Access-Control-Allow-Origin/)
assert.doesNotMatch(source, /SUPABASE_SECRET_KEYS|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|supabaseAdmin/i)

for (const operation of ['create_contact', 'open_obligation', 'list_contacts', 'list_obligations', 'preview_settlement', 'receive_cash', 'pay_contact']) {
  assert.match(source, new RegExp(operation))
}

assert.match(docs, /HUMAN GATE.*APROBADO/i)
assert.match(docs, /fortuna-dispatch.*ACTIVE v2/i)
assert.match(docs, /verify_jwt=true/)
assert.match(docs, /67082fb9f84f7fc6ac4b328f7cdf02efd56ffe87ff3dc106a33eef9e9085597a/)
assert.match(docs, /api.*Data API Exposed Schemas/)
assert.match(docs, /fortuna_private.*excluido/)
assert.match(docs, /authenticated.*schema USAGE/)
assert.match(docs, /anon.*no tiene USAGE/)
assert.match(docs, /Hosted authenticated E2E/i)
assert.match(docs, /OPEN — Hosted/i)
assert.match(docs, /service-role/i)
assert.match(docs, /SUPABASE_PUBLISHABLE_KEYS/)
assert.match(smoke, /functions\\/v1\\/fortuna-dispatch/)
assert.match(smoke, /apikey:/)
assert.match(smoke, /response\\.status,[\\s\\S]*401/)
assert.match(smoke, /AUTH_REQUIRED/)
assert.doesNotMatch(smoke, /Authorization:/)
assert.doesNotMatch(smoke, /SERVICE_ROLE|SUPABASE_SECRET/i)

console.log('PASS — FORTUNA dispatcher source, LIVE deployment checkpoint, JWT, RPC allowlist, API/private grants, hosted E2E gate and no-service-role contract')
