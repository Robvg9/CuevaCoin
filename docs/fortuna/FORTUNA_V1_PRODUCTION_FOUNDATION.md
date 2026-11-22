# FORTUNA v1 — Production foundation (PR #50 scope)

## Status

Prepared on `feat/fortuna-production-foundation-v1` from main `c806fad2bfa93c55b6d39ba3b317001f38240ab9`.
This is a review candidate only. It has **not** been applied to the hosted Supabase project, and no financial records were written.

## Migration

`supabase/migrations/20261122140000_fortuna_v1_private_ledger_and_owner_api.sql`

- Converts the three isolated prototype SQL files into one versioned migration.
- Removes the test-only replacement of `auth.uid()`; production uses Supabase Auth's existing function.
- Creates the private ledger and owner-scoped `api` RPCs for contacts, obligations, preview, receive and pay.
- Seeds supported currencies CUP, USD and EUR with two decimal minor units.
- Adds `api.list_obligations(contact_id)`, returning description, due date, opened date, principal and remaining balance for the authenticated owner's book.
- Keeps `fortuna_private` unexposed and grants no direct table access to `anon` or `authenticated`.

## Required verification before merge

1. Apply the migration to an isolated Supabase/PostgreSQL 17 test database with real `auth.uid()` semantics (no production project).
2. Run SQL Safety and native PostgreSQL 17.11 concurrency tests against the migration itself, not only the prototype files.
3. Verify owner A cannot list, preview or commit against owner B's contact/book; include global-admin profile as a non-bypass case.
4. Verify `api.list_obligations` returns only that owner's records and the exact remaining balance after partial allocation/reversal cases.
5. Verify schema `api` remains absent from Data API exposed schemas until the separate exposure/auth review is approved.
6. Reconcile migration-ledger checksum and add this migration as **pending**, never as an applied LIVE migration.

## Human gate — hosted Supabase

Do not apply this migration, expose `api` through Data API, deploy an Edge dispatcher, change secrets/configuration, or write real financial data without explicit approval after CI passes.

## Known implementation boundary

The migration creates the database contract only. The actual app screen, Edge/API dispatch integration, hosted PostgREST exposure, JWT behavior, and end-to-end LIVE smoke remain separate work.
