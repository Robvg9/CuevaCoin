# FORTUNA v1 — Owner settlement preview and confirmation prototype

**Status:** isolated test implementation; not a production migration or deployed RPC.  
**Branch:** `feat/fortuna-settlement-preview-confirm-v1`.  
**Base:** `main` SHA `87bec3e3b6eb0fabe3f9da8670e0d7cf6fe40f03`.

## 1. RPC surface in this prototype

| RPC | Purpose |
|---|---|
| `api.preview_settlement` | Read-only calculation of FIFO/manual allocations, remaining eligible balances, excess direction, and a SHA-256 preview fingerprint |
| `api.receive_cash` | Confirm cash actually received and apply it to receivables |
| `api.pay_contact` | Confirm cash actually paid and apply it to payables |

All wrappers are `SECURITY INVOKER`. The private owner-facing facades are `SECURITY DEFINER` with `search_path=pg_catalog`; they derive the actor through `auth.uid()` and resolve the owner's book inside PostgreSQL. No client-supplied book, actor, owner, or user ID is accepted. The internal plan calculator is not executable by `anon` or `authenticated`.

## 2. Preview/confirm semantics

The preview includes:

- Book/contact/currency/flow/mode and exact cash amount in minor units.
- Every eligible outstanding obligation in the same book, contact, currency, and direction.
- FIFO order by `opened_at`, then stable obligation UUID, or normalized manual allocations.
- Allocated amount, residual excess, and the direction of the opposite obligation that excess would create.
- A SHA-256 fingerprint over the complete relevant balance snapshot and proposed allocation plan.

The fingerprint is a stale-state detector, not an authorization token. The confirmation call re-locks the contact and all eligible obligations, recalculates the plan from the ledger, and compares the new fingerprint before writing.

- If the fingerprint changed, the command fails with `fortuna_stale_preview`; the transaction rolls back, including its idempotency reservation.
- Receiving cash applies against receivables; confirmed excess creates a payable.
- Paying cash applies against payables; confirmed excess creates a receivable.
- Any positive excess requires an explicit `p_confirm_overage=true`.
- Amounts are exact positive integer-minor-unit strings; only CUP/USD/EUR at scale 2 are supported.
- Manual allocations must be unique, positive, within the selected obligation's remaining balance, and within the same owner/book/contact/currency/direction.

## 3. Atomicity, locking, and idempotency

Each confirmation is one RPC and one PostgreSQL transaction.

1. Authenticate with `auth.uid()` and resolve the owner's book.
2. Lock the contact row first. This serializes settlement calls on a contact and prevents a concurrent obligation insert from joining the snapshot unnoticed (the insert's FK key-share lock conflicts with the contact's FOR UPDATE lock).
3. Reserve the idempotency key, with the payload hash computed by PostgreSQL. A same-key/same-payload committed retry returns the stored response; a changed payload conflicts.
4. Lock eligible obligation rows in a stable UUID order.
5. Recalculate the complete snapshot and compare the preview fingerprint.
6. Insert event, allocations, signed ledger lines, any confirmed opposite obligation, audit row, and committed idempotency result.
7. Reconcile the sum of event ledger entries against the actual cash amount.
8. Commit once; any exception rolls back all records and the reservation.

The reservation/replay check occurs before freshness comparison, so a retry of a previously committed identical request returns its original result even though the original write changed the balances.

## 4. Verification in this branch

The Atomic UI workflow runs `scripts/verify-fortuna-owner-settlement-api.mjs` in isolated PGlite/PostgreSQL 17. It verifies:

- Minimal API/function grants and no direct client access to private financial tables or the internal plan calculator.
- SECURITY INVOKER wrappers and fixed-search-path SECURITY DEFINER facades.
- FIFO and manual calculations, with the approved direction/sign rules.
- Exact same-key replay and changed-payload conflict.
- No writes on a stale fingerprint or unconfirmed excess.
- Confirmed received excess creates a payable; confirmed paid excess creates a receivable.
- Owner isolation, including a global CuevaCoin administrator fixture, and anon/no-subject denial.

The Native PostgreSQL 17.11 workflow additionally uses independent database sessions to verify:

- A concurrent same-key request blocks on the contact row and replays the original event after commit.
- Two distinct confirmations based on the same preview serialize; the second request receives `fortuna_stale_preview` and leaves no event or idempotency reservation.

These tests manually set `request.jwt.claim.sub`. They do not verify real Supabase JWT signatures, expiry/revocation, Auth, hosted PostgREST/Data API exposure, or the Edge Runtime.

## 5. Explicitly out of scope

This prototype does not implement a production Edge HTTP dispatcher, hosted API schema exposure, database migration, or UI. It does not deploy or alter any Supabase configuration, secret, function, or production data. Compensation, reversal, and event-history commands remain separate work. The existing native concurrency fixture still contains its own isolated test helper; the new owner API path is separately covered by the added native concurrent-session scenario.

A separate Human Gate remains mandatory before any hosted migration, adding `api` to Data API Exposed Schemas, Edge deployment, secret/config change, or real financial write.
