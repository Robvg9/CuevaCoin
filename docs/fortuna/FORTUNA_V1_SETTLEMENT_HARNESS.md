# MISIÓN FORTUNA — Isolated settlement operation harness

**Status:** test-only operation prototype; not production code, an approved RPC, or a migration.

## Purpose

PR #41 verifies that one financial command commits or rolls back its event, allocations, ledger, audit and idempotency result as a unit. This harness adds the settlement rules that must be checked before a real operation can be built:

- Cash received applies only to open receivables for the same book, contact and currency.
- Cash paid applies only to open payables for the same book, contact and currency.
- FIFO orders by `opened_at`, then stable obligation UUID.
- Manual allocation validates every requested obligation, direction, currency, contact, duplicate ID and current pending balance.
- Allocations cannot exceed the actual remaining balance or the full cash movement.
- A remaining amount is an overage. It is rejected unless the caller explicitly confirms it.
- A confirmed received overage creates a new payable; a confirmed paid overage creates a new receivable.
- The signed ledger lines must reconcile to the complete cash amount, including any new opposite obligation.

## Isolated SQL helper

`supabase/tests/fortuna_v1_settlement_prototype.sql` adds `test_commit_settlement_atomic`. The helper:

1. Reserves an idempotency identity scoped by book, actor and key.
2. Locks eligible obligations in deterministic UUID order before calculating their current signed balance.
3. Calculates FIFO allocations or validates the exact manual selections against live-in-transaction pending balances.
4. Requires explicit overage confirmation before writing.
5. Inserts the event, allocations and signed ledger lines; creates an opposite obligation for an explicitly confirmed overage.
6. Verifies that the event's ledger delta equals the complete cash movement.
7. Appends audit and commits the idempotent response in the same function call.

The helper exposes test-only failpoints around overage creation and write stages. A failure after a new overage obligation is inserted must leave no event, allocation, obligation, ledger, audit or idempotency row behind.

## What is tested

The Node/PGlite verifier seeds open receivables and payables, then tests:

- FIFO oldest-first ordering and UUID tie-breaking.
- Manual receipt to a selected receivable.
- Manual payment distributed across multiple payables.
- Rejection of wrong-direction, cross-currency, duplicate and over-pending manual allocations.
- Received and paid overages rejected without confirmation.
- Confirmed received overage opens a payable for exactly the excess.
- Confirmed paid overage opens a receivable for exactly the excess.
- Ledger reconciliation to the full cash amount in each direction.
- Idempotent replay and conflicting-payload rejection.
- Rollback after inserting an overage obligation but before the remaining ledger/audit/idempotency writes.

## Limitations and safety boundaries

- The actor and book identifiers are inputs only because a test needs a simulated trusted caller. Production must derive the actor from a verified Supabase session and resolve/authorize the book on the server.
- FIFO/manual selection runs sequentially in one PGlite connection. It does not prove concurrent transactions, real row-lock contention, isolation anomalies or protection against two simultaneous settlements.
- The helper's deterministic lock order is a test of intended SQL shape, not proof of concurrent safety. A dedicated multi-connection PostgreSQL test remains required.
- This prototype does not resolve the three remaining product gates: same-currency opposite-direction presentation, the initial currency catalogue/scales, and owner-only versus delegated members.
- PGlite does not prove Supabase Auth/JWT, Data API, Edge Runtime, connection pooling, deployment, or production grants.
- No real migration, RPC/Edge Function, UI or live schema was changed. No Supabase LIVE connection is used. The internal wallet, transfers, payroll, cash register, inventory and financial records remain untouched.

## CI

The existing Atomic UI workflow installs the pinned PGlite 0.4.6 runtime under `%RUNNER_TEMP%\fortuna-pglite` and runs this operation verifier after loading the isolated schema prototype. SQL Safety also runs because the fixture lives under `supabase/tests/`. Both workflows must finish SUCCESS on the exact PR head before merge.
