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

- Deploy with Supabase Edge Function JWT verification explicitly enabled (`verify_jwt=true`).
- `supabase.auth.getUser()` independently validates the caller's bearer token.
- The same `Authorization: Bearer <user JWT>` header is forwarded for the RPC request.
- No service-role/secret key, admin client, or RLS bypass is used.
- The publishable key is preferred; the legacy anon key is a compatibility fallback only.
- Database ownership and isolation remain enforced by the authenticated owner-scoped API.
- CORS accepts the current CuevaCoin production origin only; requests without an Origin header remain usable by native clients.

## LIVE API activation checkpoint — 2026-11-22

- The owner confirmed that `api` is included in the Data API Exposed Schemas allowlist, retaining `public` and `graphql_public` and keeping `fortuna_private` excluded. The current allowlist cannot be independently read through the available Supabase database connector; this item is recorded as owner-confirmed Dashboard state.
- The approved grant `GRANT USAGE ON SCHEMA api, fortuna_private TO authenticated` was applied successfully to hosted Supabase.
- Post-grant catalog verification: `authenticated` has schema USAGE on `api` and `fortuna_private`; `anon` has no USAGE on either schema.
- The seven `api` wrappers remain `SECURITY INVOKER`; EXECUTE is granted to `authenticated` and denied to `anon`.
- All nine private FORTUNA tables retain no direct SELECT/INSERT/UPDATE/DELETE privileges for either `authenticated` or `anon`. No financial rows were created.
- `fortuna-dispatch` is not deployed. Its deployment remains a separate HUMAN GATE.

## HUMAN GATE — deploy dispatcher only

The API schema activation and minimum schema grants are complete. Do not repeat those changes. The next production change is to deploy this Edge Function with `verify_jwt=true`, after a separate explicit approval.

The dispatcher must continue to fail closed with `FORTUNA_API_SCHEMA_NOT_EXPOSED` if the `api` schema is later removed from the Exposed Schemas allowlist. That response is a configuration-drift safeguard, not the current expected state.

Do not broaden table grants. Keep function-level EXECUTE grants as the callable database surface. Do not add secrets, use `service_role`, create financial test data, or connect the financial UI as part of deployment.

After the dispatcher deployment gate is approved, the rollout sequence is:
1. Deploy `fortuna-dispatch` with `verify_jwt=true`.
2. Verify the deployed function version and JWT verification setting.
3. Run authenticated owner-A/owner-B E2E checks for contact/obligation operations, settlement preview, receive/pay, owner isolation, idempotent replay and expected conflict 409 responses, without real money or production financial writes.
4. Only after hosted E2E passes, wire the financial UI to the dispatcher and verify the complete user flow.

## Verification

`scripts/verify-fortuna-edge-dispatch.mjs` statically enforces JWT forwarding, Auth validation, the seven-operation allowlist, publishable-key preference with legacy fallback, payload bounds, fail-closed behavior if the API schema is no longer exposed, and absence of service-role credentials. It does not claim hosted availability or deployment.
