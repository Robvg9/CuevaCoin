# FORTUNA v1 — Authenticated Edge/API endpoint contract

**Status:** design proposal for review and isolated implementation planning. Not implemented, not a migration, and not permission to alter Supabase Data API settings or deploy an Edge Function.  
**Design base:** `main` SHA `bd98f321dbd1bde790854a3f47273697eef2bcd9`.  
**Depends on:** approved product decisions, atomic transaction design, owner-only RLS gate, and the test-only API/private boundary prototype.

## 1. Decision for the v1 request path

Use one authenticated Edge Function as the transport façade and one database RPC per command:

`CuevaCoin client → POST /functions/v1/fortuna-v1 → Edge JWT verification → user-scoped Supabase context → api.<allowlisted RPC> → fortuna_private.<transaction helper> → private tables`

- The Edge Function is user-facing and keeps `verify_jwt = true`.
- The handler uses `withSupabase({ auth: 'user' })` (or the current official equivalent) and the caller-scoped `ctx.supabase`. If the installed SDK/context does not provide the verified user object, verify the bearer token with `auth.getUser(jwt)` before dispatch.
- The handler forwards the same user JWT through the user-scoped Supabase client when it calls `.schema('api').rpc(...)`. It must not switch to an admin client.
- PostgreSQL remains the authorization and transaction authority: every private operation derives the actor from `auth.uid()`, resolves the owner's book itself, and verifies that every referenced contact, obligation, event, and allocation belongs to that book.
- Each write command maps to exactly one RPC and one PostgreSQL transaction. Never split a financial write across several Edge → RPC calls.
- The route does not use `service_role`, a secret key, a shared privileged database role, or client-supplied identity as authority.

This path is preferred over a shared direct-Postgres Edge connection for v1. Direct Postgres is an unselected alternative and would require a separate role, claims-per-transaction, pooling, prepared-statement, and credential review.

## 2. Supabase schema and grants boundary

The API schema is a narrow function surface, not a place for tables.

- Add `api` to the project's Data API Exposed Schemas only after an independent Human Gate. Preserve existing exposed schemas required by CuevaCoin; do not replace `public` indiscriminately.
- Never expose `fortuna_private`. It contains the book tables, ledger, idempotency records, audit evidence, and internal helpers.
- The `authenticated` role receives `USAGE` on `api` and `EXECUTE` only on the explicit public wrappers required by the user path.
- `anon` receives no FORTUNA schema/function access. No client role receives direct SELECT/INSERT/UPDATE/DELETE access to FORTUNA tables.
- The prototype wrapper is `SECURITY INVOKER`; it delegates to a narrowly scoped `SECURITY DEFINER` helper in `fortuna_private`. Because the wrapper executes as the caller, the caller also needs only the minimum schema/function privileges required to resolve that helper. Those grants do not expose the private schema through PostgREST; nevertheless, they are SQL privileges and must be explicitly audited. Do not copy prototype grants without reviewing the final call graph.
- Revoke unintended `EXECUTE` from `PUBLIC` (including inherited/default privileges) on every private helper and API wrapper, then grant only the exact required roles. Do not rely on the schema being unexposed as a substitute for function grants.
- Keep RLS enabled on all private tables as defense in depth. Every privileged helper must independently require a non-null `auth.uid()`, derive the book from `owner_user_id = auth.uid()`, and enforce book ownership for every resource. A helper must not assume its `SECURITY DEFINER` owner is constrained by RLS.
- Pin function `search_path` to `pg_catalog` (or an empty path where supported) and fully qualify every referenced object, including `auth.uid()`. No dynamic SQL based on request values.

Important distinction: grants determine whether a role can reach a database object; RLS determines which rows a role can access. Function RPC access is controlled by EXECUTE grants, and RLS does not automatically secure a function. Review both controls and every definer function.

## 3. HTTP transport contract

**Method and route:** `POST /functions/v1/fortuna-v1`  
**Authentication:** `Authorization: Bearer <Supabase user JWT>`; the project publishable key belongs in `apikey`, never as a substitute bearer token.  
**Content type:** `application/json`.

Request envelope:

```json
{
  "version": 1,
  "command": "open_obligation",
  "idempotency_key": "client-generated-unique-key",
  "data": {
    "contact_id": "uuid",
    "direction": "receivable",
    "currency": "CUP",
    "amount_minor": "12500",
    "description": "Préstamo acordado"
  }
}
```

Rules:

- `version` must be supported; unknown versions and commands are rejected.
- `command` is an allowlisted enum. The Edge handler maps each command to a fixed RPC name; it never accepts a schema, table, function name, SQL fragment, or RPC name from the body.
- `data` is strictly validated per command. Reject unknown fields, malformed IDs, invalid enum values, oversized strings, and out-of-range pagination.
- `idempotency_key` is mandatory for every state-changing command and forbidden/ignored for read-only commands only according to one documented convention. The chosen v1 convention is: required for writes, omitted for reads and previews.
- Amounts are decimal strings in integer minor units (for example, `"12500"` means 125.00 at scale 2). Do not use JavaScript floating-point numbers as the exact monetary source. The server validates positivity, integer syntax, range, currency, and scale.
- The only v1 currencies are CUP, USD, and EUR, each with scale 2. No FX, implicit conversion, or silent rounding.
- Client-supplied `contact_id`, `obligation_id`, and `event_id` identify target resources only; the database must still prove each belongs to the caller's book. Never accept `owner_user_id`, `actor_user_id`, `user_id`, or `book_id` as identity or authorization evidence.
- A settlement preview is read-only. Its server-generated fingerprint is a stale-state detector, not an authorization token. On confirmation, the write RPC locks and recalculates affected obligations before applying anything.

## 4. Command surface proposal

All names below are proposed logical commands/RPCs. They do not exist merely because this document lists them.

| Command | Mode | Purpose |
|---|---|---|
| `get_book_summary` | Read | Gross receivable/payable totals per currency |
| `list_contacts` | Read | One contact per card, with per-currency gross positions |
| `get_contact_detail` | Read | Contact, open obligations, event history, and allocations |
| `list_book_events` | Read | Paginated immutable event history |
| `preview_settlement` | Read-only preview | FIFO suggestion or manual plan, open balances, excess, and fingerprint |
| `create_contact` | Write | Create an external contact |
| `update_contact` | Write | Update allowed descriptive fields; audit the change |
| `archive_contact` | Write | Archive without deleting accounting history |
| `open_obligation` | Write | Recognize a receivable or payable |
| `receive_cash` | Write | Record cash actually received, apply to receivables, and require excess confirmation |
| `pay_contact` | Write | Record cash actually delivered, apply to payables, and require excess confirmation |
| `compensate_obligations` | Write | Explicit same-contact, same-currency opposite-direction compensation |
| `reverse_event` | Write | Linked, reasoned, bounded reversal; never edit/delete the source event |

Each write is implemented as one API wrapper and one private transaction helper. Read functions return only the current owner's data. Do not add a generic arbitrary-SQL or generic table CRUD endpoint.

## 5. Write transaction contract

Every write RPC must execute the entire command atomically:

1. Require authenticated `auth.uid()`; resolve the current book by owner relation inside the database.
2. Validate that all referenced resources belong to that book. Do not reveal whether another owner's resource exists; return a non-enumerating not-found/forbidden result.
3. Canonicalize command + API version + resource IDs + currency + amount strings converted to exact integer minor units + allocation choices + confirmations + reason. Exclude transport metadata.
4. Compute the canonical SHA-256 payload hash on the server. Never trust a client-provided hash.
5. Reserve/replay the idempotency key inside the same transaction. Same key + same hash + committed returns the stored result without new rows. Same key + different hash returns conflict without writes.
6. Lock the book/contact and affected obligations in a deterministic order. Recompute all open amounts from the committed ledger after locks are acquired.
7. Validate direction, currency/precision, allocations, settlement bounds, preview freshness, excess confirmation, compensation pairing, and reversal limits.
8. Insert the immutable event, allocations, signed ledger lines, and audit record; create any confirmed excess obligation within the same transaction.
9. Reconcile obligation balances and contact/currency gross totals from the ledger.
10. Store the response and mark the idempotency record committed, then commit once. Any failure rolls back every write in the command.

No function may update/delete a confirmed financial event, allocation, ledger line, or audit evidence. Corrections are linked inverse events. A reversal of compensation must reverse both sides together.

## 6. Settlement confirmation rules

The preview must show the gross cash amount, eligible obligations, proposed FIFO/manual allocations, each remaining balance, residual excess, and the direction of the obligation that excess would create.

- Receiving money applies first to receivables. Confirmed excess creates a payable.
- Paying money applies first to payables. Confirmed excess creates a receivable.
- A positive excess without an explicit acknowledgement is rejected before any write.
- A changed preview fingerprint returns `STALE_PREVIEW`; the client must show a fresh preview and obtain confirmation again.
- FIFO is only a suggestion; a manual plan remains allowed if it passes the same server-side limits.

## 7. Response and error contract

Success:

```json
{
  "ok": true,
  "version": 1,
  "data": {
    "event_id": "uuid",
    "currency": "CUP",
    "allocations": [],
    "gross_position": {},
    "excess": { "amount_minor": "0", "created_obligation_id": null }
  },
  "meta": {
    "replayed": false,
    "request_id": "opaque-request-id"
  }
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "STALE_PREVIEW",
    "message": "La situación cambió; revisa la nueva distribución antes de confirmar."
  },
  "meta": {
    "request_id": "opaque-request-id"
  }
}
```

Stable error codes include:

- `UNAUTHENTICATED` (401): missing, invalid, expired, or revoked session.
- `VALIDATION_ERROR` (400/422): invalid command payload, currency, amount, or precision.
- `NOT_FOUND` (404): resource absent from the caller's book; do not disclose cross-owner existence.
- `STALE_PREVIEW` (409): settlement snapshot changed; no write performed.
- `IDEMPOTENCY_CONFLICT` (409): same key reused with a different canonical payload.
- `IDEMPOTENCY_IN_PROGRESS` (409): unexpected unresolved reservation; requires integrity/recovery handling, never blind replay.
- `EXCESS_CONFIRMATION_REQUIRED` (422): no write performed until the owner confirms the excess.
- `SETTLEMENT_LIMIT_EXCEEDED` (409): an obligation no longer has the requested open amount.
- `INVALID_COMPENSATION` (422): different contact/currency/direction or invalid amount.
- `REVERSAL_NOT_ALLOWED` (409): target is not reversible by the requested amount.
- `INTERNAL_ERROR` (500): generic response; never return SQL, stack traces, secrets, or database internals.

Edge transport maps errors deterministically and does not expose Postgres hints or private object names to the client.

## 8. Security and integration acceptance gates

Before a production migration or API implementation can be approved, add tests for:

1. Edge gateway rejects no JWT, malformed JWT, wrong-project JWT, expired JWT, and revoked/deleted user as applicable; valid JWT reaches handler.
2. Edge handler uses a caller-scoped client and never constructs or calls an admin/service-role client for FORTUNA.
3. A caller cannot select another actor/book by adding `owner_user_id`, `actor_user_id`, `user_id`, or `book_id` to any payload.
4. Owner A can access only A's data; owner B, a global CuevaCoin admin who is not the book owner, external contacts, and anon are denied.
5. `fortuna_private` is absent from Data API Exposed Schemas; only the intentional `api` RPC surface is exposed.
6. Direct table access is denied to `anon` and `authenticated`; unapproved function EXECUTE is denied, including inherited PUBLIC grants.
7. Two concurrent settlements cannot exceed an obligation's open amount; duplicate same-key requests create one event; a changed payload under the same key is rejected.
8. Failure injection between writes leaves no partial event, allocation, ledger, audit, excess obligation, or committed idempotency row.
9. Preview drift forces a fresh preview; excess requires explicit confirmation; compensation/reversal invariants remain paired and bounded.
10. FORTUNA has zero writes to CuevaCoin wallet balances, transfers, payroll, cash, inventory, and other business records.

The existing PGlite API-boundary prototype manually sets a JWT subject claim. The Native PostgreSQL harness proves database-level concurrency behavior. Neither is evidence of real Supabase Auth/JWT verification, hosted PostgREST/Data API exposure, or Edge Runtime. These hosted checks remain OPEN until an isolated, authorized, zero-cost test target is available. Do not create a paid branch/project or reuse CuevaCoin, BattleCruiser, or SimpleLife production projects.

## 9. Rollout order and separate Human Gates

1. Review and accept this endpoint contract. Documentation alone does not enable a route.
2. Implement and test wrappers/helpers in an isolated branch; add SQL safety, Atomic UI, Native PostgreSQL concurrency, and Edge unit tests.
3. Verify a real hosted Auth/JWT + Edge + Data API path in an isolated authorized zero-cost target. If no such target is available, stop and keep the hosted proof explicitly OPEN.
4. Review grants/default privileges, schema exposure, Security/Performance advisors, and exact migration diff.
5. A separate Human Gate is required before adding `api` to Data API Exposed Schemas or applying any Supabase migration.
6. A separate Human Gate is required before deploying the Edge Function or changing secrets/configuration.
7. Verify deployment hashes/versions, then perform authenticated E2E with test users and no real financial movements.
8. Production rollout and any real FORTUNA financial record require their own explicit authorization.

No step in this document authorizes a LIVE migration, schema exposure, Edge deployment, secret change, or financial write.

## 10. References

- [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Authorization headers and verify_jwt](https://supabase.com/docs/guides/functions/auth-headers)
- [Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [Using Custom Schemas](https://supabase.com/docs/guides/api/using-custom-schemas)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
