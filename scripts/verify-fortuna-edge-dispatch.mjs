import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../supabase/functions/fortuna-dispatch/index.ts', import.meta.url), 'utf8')
const docs = await readFile(new URL('../docs/fortuna/edge-dispatcher.md', import.meta.url), 'utf8')

assert.match(source, /createClient\(SUPABASE_URL, SUPABASE_ANON_KEY/)
assert.match(source, /supabase\.auth\.getUser\(\)/)
assert.match(source, /Authorization: authHeader/)
assert.match(source, /supabase\.schema\('api'\)\.rpc\(rpc, body\.args\)/)
assert.match(source, /FORTUNA_API_SCHEMA_NOT_EXPOSED/)
assert.match(source, /PGRST202/)
assert.match(source, /MAX_BODY_BYTES/)
assert.match(source, /OPERATION_NOT_ALLOWED/)
assert.match(source, /Access-Control-Allow-Origin/)
assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role|supabaseAdmin/i)
for (const operation of ['create_contact', 'open_obligation', 'list_obligations', 'preview_settlement', 'receive_cash', 'pay_contact']) {
  assert.match(source, new RegExp(operation))
}
assert.match(docs, /HUMAN GATE/i)
assert.match(docs, /not exposed/i)
assert.match(docs, /service_role/i)
console.log('PASS — FORTUNA Edge Dispatcher user-JWT, RPC allowlist, payload bounds and no-service-role contract')
