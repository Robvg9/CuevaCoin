import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const APP_ORIGIN = 'https://cuevacoin.robvg9.workers.dev'
const MAX_BODY_BYTES = 32 * 1024

const RPC_BY_OPERATION = {
  create_contact: 'create_contact',
  open_obligation: 'open_obligation',
  list_contacts: 'list_contacts',
  list_obligations: 'list_obligations',
  preview_settlement: 'preview_settlement',
  receive_cash: 'receive_cash',
  pay_contact: 'pay_contact',
} as const

const baseHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '600',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Vary': 'Origin',
}

function reply(body: unknown, status = 200, origin?: string) {
  const headers: Record<string, string> = { ...baseHeaders }
  if (origin === APP_ORIGIN) headers['Access-Control-Allow-Origin'] = APP_ORIGIN
  return new Response(JSON.stringify(body), { status, headers })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function resolvePublicApiKey(): string | undefined {
  const rawPublishableKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (rawPublishableKeys) {
    try {
      const keys: unknown = JSON.parse(rawPublishableKeys)
      if (isRecord(keys) && typeof keys.default === 'string' && keys.default.trim()) {
        return keys.default
      }
    } catch {
      // Fall back to the legacy anon key during the platform's transition period.
    }
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? undefined
}

const SUPABASE_PUBLIC_KEY = resolvePublicApiKey()

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? undefined
  if (origin && origin !== APP_ORIGIN) return reply({ error: 'ORIGIN_NOT_ALLOWED' }, 403)
  if (req.method === 'OPTIONS') return new Response(null, {
    status: 204,
    headers: { ...baseHeaders, ...(origin === APP_ORIGIN ? { 'Access-Control-Allow-Origin': APP_ORIGIN } : {}) },
  })
  if (req.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405, origin)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !/^Bearer\s+\S+$/i.test(authHeader)) {
    return reply({ error: 'AUTH_REQUIRED' }, 401, origin)
  }
  const accessToken = authHeader.replace(/^Bearer\s+/i, '')
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    return reply({ error: 'SERVICE_UNAVAILABLE' }, 503, origin)
  }

  let rawBody: string
  try {
    const reader = req.body?.getReader()
    if (!reader) return reply({ error: 'INVALID_JSON' }, 400, origin)
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > MAX_BODY_BYTES) {
          await reader.cancel()
          return reply({ error: 'REQUEST_TOO_LARGE' }, 413, origin)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    rawBody = new TextDecoder().decode(bytes)
  } catch {
    return reply({ error: 'INVALID_REQUEST_BODY' }, 400, origin)
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return reply({ error: 'INVALID_JSON' }, 400, origin)
  }
  if (!isRecord(body) || typeof body.operation !== 'string' || !isRecord(body.args)) {
    return reply({ error: 'INVALID_REQUEST' }, 400, origin)
  }

  const rpc = Object.hasOwn(RPC_BY_OPERATION, body.operation)
    ? RPC_BY_OPERATION[body.operation as keyof typeof RPC_BY_OPERATION]
    : undefined
  if (!rpc) return reply({ error: 'OPERATION_NOT_ALLOWED' }, 400, origin)

  try {
    // Keep the caller's JWT on every Auth and PostgREST request. This client uses
    // only a public publishable/legacy anon key; owner isolation is enforced by the database API.
    const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: authError } = await supabase.auth.getUser(accessToken)
    if (authError || !userData.user) return reply({ error: 'AUTH_INVALID' }, 401, origin)

    const { data, error } = await supabase.schema('api').rpc(rpc, body.args)
    if (error) {
      // Return a stable HTTP conflict when a caller reuses an idempotency key
      // with a different payload. Never expose raw database error details.
      if (error.code === 'P0001' && error.message === 'fortuna_idempotency_conflict') {
        return reply({ error: 'IDEMPOTENCY_CONFLICT' }, 409, origin)
      }
      // The api schema must remain in the hosted PostgREST Exposed Schemas allowlist.
      // If that configuration drifts, fail closed rather than falling back to
      // service_role or routing through a broader public schema.
      if (error.code === 'PGRST106') {
        return reply({ error: 'FORTUNA_API_SCHEMA_NOT_EXPOSED' }, 503, origin)
      }
      if (error.code === 'PGRST202' || error.code === '42883') {
        return reply({ error: 'FORTUNA_API_MIGRATION_NOT_AVAILABLE' }, 503, origin)
      }
      console.error('[fortuna-dispatch] RPC rejected', { operation: body.operation, code: error.code ?? 'unknown' })
      return reply({ error: 'FORTUNA_OPERATION_REJECTED' }, 400, origin)
    }

    return reply({ data }, 200, origin)
  } catch {
    console.error('[fortuna-dispatch] unexpected request failure')
    return reply({ error: 'SERVICE_UNAVAILABLE' }, 503, origin)
  }
})
