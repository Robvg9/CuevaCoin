# FORTUNA Edge Dispatcher — v1

## Scope

Adds a user-facing Edge Function that dispatches only the seven reviewed FORTUNA owner RPCs:
- `create_contact`
- `open_obligation`
- `list_contacts`
- `list_obligations`
- `preview_settlement`
- `receive_cash`
- `pay_contact`

The dispatcher extracts the bearer token, validates that exact token with `supabase.auth.getUser(accessToken)`, forwards the original Authorization header to PostgREST, and uses the default `SUPABASE_PUBLISHABLE_KEYS` entry when available, falling back to the legacy public `SUPABASE_ANON_KEY` during the transition period. Neither key bypasses RLS. The operation name is allow-listed; clients cannot select arbitrary RPC names. Request bodies are capped at 32 KiB. Responses avoid returning raw SQL/PostgREST errors.

## Security invariants

- Supabase Edge Function JWT verification remains enabled by the platform default; no `verify_jwt = false` override is introduced.
- `supabase.auth.getUser()` validates the caller's bearer token.
- The same `Authorization: Bearer <user JWT>` header is forwarded for the RPC request.
- No service-role/secret key, admin client, or RLS bypass is used.
- The publishable key is preferred; the legacy anon key is a compatibility fallback only.
- Database ownership and isolation remain enforced by the migration's authenticated owner-scoped API.
- CORS accepts the current CuevaCoin production origin only; requests without an Origin header remain usable by native clients.

## Hosted status — migration applied, API still closed (2026-11-22)

The exact FORTUNA migration is applied to hosted Supabase as migration version `20261122173537`. It creates nine tables in `fortuna_private`, all with RLS enabled, and seeds only CUP/USD/EUR. No books, contacts, obligations, events, ledger entries, allocations, idempotency rows or audit rows were created.

The schemas `api` and `fortuna_private` remain unusable by client roles: `anon` and `authenticated` have no schema `USAGE`, and neither role has direct table privileges. `service_role` has backend-only `USAGE` on `fortuna_private`; it has no `USAGE` on `api`. The actual Data API Exposed Schemas setting is not certified yet and has not been changed. `fortuna_private` must never be added to that allowlist.

This dispatcher must continue to fail closed with `FORTUNA_API_SCHEMA_NOT_EXPOSED` until a separate release gate verifies the Data API allowlist and explicitly grants the minimum `USAGE` needed on `api` and `fortuna_private` to `authenticated`.

Do not broaden table grants. Keep the migration's function-level grants as the permission boundary. Do not expose the schema, add secrets, deploy this function, or write financial data as part of this code change.

After the separate API activation gate is approved, the rollout sequence is:
1. Verify the actual Dashboard → API Settings → Exposed schemas list; add only `api` if required. Keep `fortuna_private` absent.
2. Reconfirm the exact grants and RLS boundary, then grant only the required schema `USAGE` to `authenticated`.
3. Deploy this function with JWT verification enabled.
4. Run authenticated owner-A/owner-B E2E checks and verify no service-role key or service-role client is used.
5. Only then wire the financial UI to the dispatcher.

## Verification

`scripts/verify-fortuna-edge-dispatch.mjs` statically enforces the JWT forwarding, Auth validation, the seven-operation allowlist, publishable-key preference with legacy fallback, payload bound, schema-unavailable fail-closed behavior, and absence of service-role credentials. It does not claim hosted availability or deployment.
