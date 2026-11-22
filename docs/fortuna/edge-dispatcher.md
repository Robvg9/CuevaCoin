# FORTUNA Edge Dispatcher — v1

## Scope

Adds a user-facing Edge Function that dispatches only the six reviewed FORTUNA owner RPCs:
- `create_contact`
- `open_obligation`
- `list_obligations`
- `preview_settlement`
- `receive_cash`
- `pay_contact`

The dispatcher extracts the bearer token, validates that exact token with `supabase.auth.getUser(accessToken)`, forwards the original Authorization header to PostgREST, and uses only the public anon key. The operation name is allow-listed; clients cannot select arbitrary RPC names. Request bodies are capped at 32 KiB. Responses avoid returning raw SQL/PostgREST errors.

## Security invariants

- Supabase Edge Function JWT verification remains enabled by the platform default; no `verify_jwt = false` override is introduced.
- `supabase.auth.getUser()` validates the caller's bearer token.
- The same `Authorization: Bearer <user JWT>` header is forwarded for the RPC request.
- No service-role key, admin client, or RLS bypass is used.
- Database ownership and isolation remain enforced by the migration's authenticated owner-scoped API.
- CORS accepts the current CuevaCoin production origin only; requests without an Origin header remain usable by native clients.

## Hosted prerequisite — HUMAN GATE

The migration creates schema `api`, but the hosted Supabase Data API currently does not expose that schema. Therefore this function intentionally returns `FORTUNA_API_SCHEMA_NOT_EXPOSED` until the owner explicitly approves adding `api` to Supabase Dashboard → API Settings → Exposed schemas.

Do not broaden table grants. The migration's function-level grants are the intended permission boundary. Do not apply the migration, expose the schema, add secrets, deploy this function, or write financial data as part of this PR.

After the Human Gate is approved, the rollout sequence is:
1. Apply the reviewed migration to hosted Supabase.
2. Expose only schema `api` in Data API settings after rechecking the grants and RLS boundary.
3. Deploy this function with the default JWT verification enabled.
4. Run authenticated owner-A/owner-B E2E checks and verify no service-role use.
5. Only then wire the financial UI to the dispatcher.

## Verification

`scripts/verify-fortuna-edge-dispatch.mjs` statically enforces the JWT forwarding, Auth validation, allowlist, payload bound, schema-unavailable fail-closed behavior, and absence of service-role credentials. It does not claim hosted availability or deployment.
