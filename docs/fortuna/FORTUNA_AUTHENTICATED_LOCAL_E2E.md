# FORTUNA — authenticated local Supabase E2E

## Purpose

This workflow exercises Supabase Auth, the Edge Runtime, PostgREST and PostgreSQL against a disposable local stack on a GitHub-hosted Ubuntu runner. It never links to or calls a hosted Supabase project.

## Isolation and cost boundary

- Runner: `ubuntu-latest`, standard public-repository GitHub-hosted runner.
- CLI: pinned to Supabase CLI `3.2.0`.
- Runtime: local Docker containers only; repository migrations are applied with `supabase db reset`.
- The workflow never runs `supabase link`, `supabase db push`, `supabase functions deploy`, `--linked`, `--remote`, or supplies a hosted project ref.
- No repository secrets, Supabase Management token, service-role key, hosted JWT or hosted user credentials are used.
- Two synthetic Auth users are registered locally with email confirmation disabled only in the local config. Passwords and JWTs are generated at runtime and never written to logs or artifacts.
- Test contacts, obligations and ledger events exist only inside the disposable local PostgreSQL container. Cleanup stops the stack; the GitHub runner itself is ephemeral.
- A local-only SQL fixture grants `authenticated` schema USAGE on `api` and `fortuna_private`, mirroring the separately approved LIVE schema grant. It does not grant direct table access.

## Acceptance coverage

1. Edge gateway rejects missing and malformed JWTs (HTTP 401).
2. Two real local Auth signups produce separate user JWTs.
3. Owner A creates a contact and obligation; same-key/same-payload retries return the original IDs.
4. Same idempotency key with a changed payload returns HTTP 409 `IDEMPOTENCY_CONFLICT`.
5. Owner A and Owner B cannot see each other's contacts.
6. Owner B cannot read or create an obligation against Owner A's contact.
7. Rejected cross-owner requests leave Owner A's obligation count unchanged.

## Relationship to LIVE

This is an isolated integration test. It does not deploy the dispatcher or migrations to CuevaCoin LIVE and does not change hosted project settings. The LIVE Edge Function remains at the separately recorded ACTIVE v2 deployment until a separate review and explicit deployment authorization. Passing this local test does not prove the hosted CuevaCoin project's JWT signing keys or Dashboard configuration, and does not authorize the FORTUNA UI release.

## Current limitations

The local Supabase runtime exercises the actual repository migrations and local Supabase components, but does not validate hosted JWT signing keys, Dashboard Exposed Schemas, hosted rate limits, or production environment settings. Hosted authenticated E2E remains OPEN until a dedicated zero-cost hosted test target is formally available; no test finance records may be written to the LIVE project.
