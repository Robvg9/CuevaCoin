# MISIÓN FORTUNA — PostgreSQL isolated schema tests

**Status:** technical prototype, not production schema and not a migration.

## Purpose

The CuevaCoin runner has Node.js 22 but no Docker, psql, local PostgreSQL server, or usable Supabase CLI download. This harness pins the test-only package @electric-sql/pglite@0.4.6, which is expected to use the PostgreSQL 17 major line, to run schema checks in an isolated in-memory database on the existing Windows runner. PGlite 0.5.x upgraded its embedded engine to PostgreSQL 18, so it is intentionally not used for this PG17 major-version check. The test itself reads SELECT version() and fails unless the reported major is 17. The package is installed under %RUNNER_TEMP%; it does not become an application dependency.

The SQL fixture at supabase/tests/fortuna_v1_schema_prototype.sql is loaded only by this ephemeral test. It is deliberately stored under supabase/tests, not supabase/migrations.

## Prototype boundaries

- One personal financial book per owner is the current simplifying assumption; it is not yet a final product approval.
- Contacts are owned by the book. An optional link to public.perfiles is unique per book and must only be set after the application verifies identity and active-account state.
- The financial_currencies catalogue is configurable. CUP/USD/EUR with scale 2 are fixtures in the test only, not a production seed decision.
- Obligations retain a non-empty description and optional due date. Amounts are signed integer minor units. Positive means the contact owes the owner; negative means the owner owes the contact.
- The original obligation, event, ledger, allocation and audit records are append-only in this prototype. Corrections use new reversal events with a required reason and inverse ledger entries; a reversal must stay on the same book/contact/currency and cannot point to itself or another reversal.
- Every FORTUNA table has RLS enabled and is placed in the non-exposed fortuna_private schema. anon and authenticated receive no direct schema/table privileges. Only the trusted server role receives table access, with UPDATE limited to selected contact and idempotency columns.
- Server code must still authenticate the caller, resolve the caller's book, and verify book ownership before using its privileged database connection. service_role must never enter browser code.

## Automated checks

The PGlite test verifies PostgreSQL DDL execution, expected tables, RLS enabled on all tables, direct-role grants, column-scoped server UPDATE privileges, owner/book uniqueness, contact/book/currency relational integrity, positive minor amounts, precision bounds, reversal links restricted to the same contact/currency (and not another reversal), immutable idempotency request identity, one-way processing-to-committed state transition, append-only triggers, audit rows, and rollback atomicity.

## What PGlite does not prove

This is real PostgreSQL 17 execution, but it is not a full Supabase environment or an exact patch-version match for CuevaCoin LIVE PostgreSQL 17.11. It does not validate Supabase Auth/JWT behavior, the Data API schema exposure settings, Edge Function authorization, Supabase advisors, production grants/default privileges, or live database concurrency under competing connections. The test stubs only the small auth.users and public.perfiles structures needed to compile the schema. Concurrency/idempotency races and owner authorization must be covered in a later integration test against a dedicated isolated Supabase/Postgres environment.

## Gates before a real migration

1. Decide how the UI labels a contact with simultaneous receivable and payable obligations in the same currency. The database keeps both gross sides distinct and does not net or compensate them automatically.
2. Confirm the initial currency list and each currency's minor-unit scale.
3. Confirm that v1 is owner-only and that no delegated members have access.
4. Review actual Supabase catalog types, policies, grants and Data API exposure before converting the prototype into a migration.
5. Generate the production migration using supabase migration new <name>; do not copy this fixture into supabase/migrations or apply it to CuevaCoin LIVE.

## Safety scope

No production migration, SQL write, Edge Function, UI, deployment, financial event, balance, transfer, payroll row or cash record is created by this PR. The harness has no credentials and makes no network connection to Supabase.
