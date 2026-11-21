# MISIÓN FORTUNA — Isolated transaction atomicity harness

**Status:** test-only proof harness; not a production implementation, RPC, migration, or approved API.

## Purpose

PR #40 defined the server-side transaction contract. This harness gives the isolated PostgreSQL 17 fixture an executable transaction envelope to verify that a financial event and its dependent rows either commit together or leave no records behind.

The helper function is deliberately named `test_commit_event_atomic` and lives only in `supabase/tests/fortuna_v1_transaction_prototype.sql`. It is not placed in `supabase/migrations/`, an Edge Function, the application, or any deployed schema.

## What a successful call commits

One function call performs the following writes in one PostgreSQL statement transaction:

1. Reserve the idempotency identity `(book_id, actor_user_id, idempotency_key)` in `processing`.
2. Create one financial event.
3. Add zero or more allocation rows.
4. Add one or more signed ledger rows.
5. Append one audit row.
6. Transition the idempotency record to `committed` with the event ID and exact response.

A replay with the same key and payload hash returns the stored response without duplicating rows. Reusing the same actor/book/key with another hash is rejected.

## Failure injection and verification

The helper exposes controlled test-only failpoints after:

- idempotency reservation;
- event creation;
- allocation insertion;
- ledger insertion;
- audit insertion;
- idempotency commit transition.

The Node/PGlite verifier invokes each failpoint and compares counts for events, allocations, ledger rows, audit rows, and idempotency rows. Every injected exception must roll the entire function call back to the exact prior state.

Additional scenarios verify a partial cash receipt, compensation represented as two equal-and-opposite ledger entries under one gross event amount, and a reasoned reversal linked to its source event. The helper tests the atomic write envelope and relational shape; it does not pretend to enforce every product rule.

## Important boundaries

- This function is test scaffolding only. Its actor and book parameters simulate a trusted server caller; production must derive the actor from a verified Supabase session and resolve/authorize the book on the server.
- The harness checks function EXECUTE grants: service_role may call the helper; anon and authenticated may not.
- The tests are sequential in one PGlite instance. They do **not** prove races between concurrent requests, row-lock behavior under multiple connections, isolation anomalies, or lock contention.
- The harness does not implement the business allocator, FIFO preview, manual allocation validation, explicit overpayment confirmation, available-balance recomputation, or partial-reversal limits. Those require dedicated operation-level tests after the remaining product gates are closed.
- PGlite does not prove Supabase Auth/JWT, Data API exposure, Edge Runtime behavior, connection-pool behavior, advisors, or deployment.
- CUP/USD are fixtures only, not an approved production currency catalogue or scale decision.
- No Supabase LIVE connection or write is made. No migrations, RPC/Edge Functions, UI, Worker, balances, transfers, payroll, cash register, stock, or financial data are changed.

## CI execution

The atomic UI workflow installs the pinned test-only `@electric-sql/pglite@0.4.6` runtime in `%RUNNER_TEMP%\fortuna-pglite`, loads the existing schema fixture followed by this transaction fixture, and runs `scripts/verify-fortuna-transaction-atomicity.mjs`.

The SQL Safety workflow also runs because the transaction fixture is under `supabase/tests/`. Both workflows must pass on the exact PR head before merge.
