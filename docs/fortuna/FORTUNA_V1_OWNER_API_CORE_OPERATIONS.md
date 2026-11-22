# FORTUNA v1 — Owner-only core API operations prototype

**Status:** isolated test implementation in progress; this is not a production migration, API deployment, or authorization to expose a schema.  
**Branch:** `feat/fortuna-owner-api-core-operations-v1`.  
**Base:** `main` SHA `8706c266107c73f00527c62690e3c49d364ac305`.

## 1. First vertical slice

This prototype adds three candidate functions to the test-only SQL overlay:

| RPC | Purpose | Transactional behavior |
|---|---|---|
| `api.create_contact` | Create an external contact (no CuevaCoin account required) | Idempotency reservation, contact row, audit row, stored response |
| `api.open_obligation` | Open a receivable or payable | Idempotency reservation, event, obligation, signed ledger entry, audit row, stored response |
| `api.list_contacts` | Return one card per contact with gross balances grouped by currency | Read-only; derives positions from ledger entries |

The wrappers are `SECURITY INVOKER`. Private helpers are `SECURITY DEFINER` with `search_path=pg_catalog`, fully qualified objects, and identity derived from `auth.uid()`. No API wrapper or private helper accepts `book_id`, `owner_user_id`, `actor_user_id`, or `user_id` from the caller.

For the first write, the helper creates the caller's single book if one does not exist. The owner is resolved only from the verified request subject in `auth.uid()`. Resource IDs such as `contact_id` are selectors, and the helper verifies they belong to that owner’s book before writing.

## 2. Atomicity and idempotency

- Both writes require a caller-supplied idempotency key.
- The canonical command payload is assembled inside PostgreSQL and hashed with SHA-256; the client does not supply a hash.
- A committed key with the same hash returns the stored response without creating additional rows. Reusing the same key with another payload raises an explicit conflict.
- Contact creation does not create a financial event. Therefore, the generic idempotency table now permits a committed response with a null `event_id`; financial event commands still attach their event ID.
- Opening an obligation inserts the event, obligation, signed ledger line, audit evidence, and committed idempotency response in the same database transaction. A failure rolls the whole RPC back.
- Amounts enter as strings in integer minor units and are converted to PostgreSQL `bigint` only after strict validation. Only CUP, USD, and EUR at scale 2 are accepted.

## 3. Read model

`api.list_contacts()` groups ledger-derived outstanding balances into one card per contact. Each currency shows **Te debe** and **Le debes** separately. Both values remain visible for a mixed position; currencies are never netted or converted. The result does not expose private table CRUD.

## 4. Verification included

`scripts/verify-fortuna-owner-api-operations.mjs` loads the schema and SQL overlays into isolated PGlite/PostgreSQL 17 and checks:

1. The exposed wrappers are invoker functions; private helpers are fixed-search-path definer functions.
2. Authenticated receives only the schema/function grants needed for the RPC call graph and no direct table SELECT/INSERT grants; anon cannot invoke the API.
3. First write creates one book per owner; duplicate contact creation and obligation opening are idempotent.
4. Changed payload under an existing key is rejected without extra rows.
5. Receivable/payable signs, currency allowlist, amount precision and bigint range are enforced.
6. A mixed same-currency contact appears once with separate gross values; another currency stays distinct.
7. A different owner, including a global CuevaCoin-admin fixture, cannot use another book’s contact ID.
8. Missing subject rejects the request; caller-supplied owner/book identity is not part of the function signatures.

These tests set `request.jwt.claim.sub` directly. They do not verify Supabase JWT signatures, expiration/revocation, actual Auth, hosted PostgREST/Data API exposure, or Edge Runtime.

## 5. Deliberately not implemented

This first slice does not expose or implement payment settlement, FIFO/manual allocations, overage confirmation, compensation, reversal, contact update/archive, detailed event history, or the Edge HTTP dispatcher. The existing settlement and transaction harnesses remain test-only prototypes. Each additional command requires its own validated SQL/helper path and tests.

No production migration, `api` Data API setting, Edge Function, secret, UI, or live database change is included. No real financial records are written. A separate Human Gate is required before any hosted schema exposure, migration, Edge deployment, secret/config change, or financial write.
