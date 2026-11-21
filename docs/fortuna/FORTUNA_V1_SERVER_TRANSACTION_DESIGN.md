# MISIÓN FORTUNA — Server operations and transaction design v1

**Status:** implementation design proposal; not an approved production API or migration.  
**Depends on:** merged PR #38 (accounting contract) and PR #39 (isolated PostgreSQL harness).  
**Scope:** define how server-side commands must preserve the ledger invariants before creating RPC/Edge code. No Supabase migration, application endpoint, UI, deployment, or LIVE write is included.

## 1. Rules already fixed by the owner

The following are contract rules, not proposals:

- FORTUNA is a separate personal obligations book. It never reads/writes perfiles.saldo, transacciones, salary batches, cash register, inventory, or business assets.
- A positive signed position means the contact owes the owner; a negative signed position means the owner owes the contact.
- Balances and gross totals are calculated separately for each currency. There is no cross-currency netting or conversion.
- Receiving money applies first to receivables; paying money applies first to payables. An excess creates the opposite obligation only after explicit confirmation.
- FIFO is a suggested preview; manual allocations remain available.
- Compensation is explicit and limited to the same contact and same currency.
- Confirmed events and ledger entries are immutable. Corrections use linked reversal events with a non-empty reason.
- Financial commands are authorized and idempotent, server-side and atomic. Browser code never receives a service-role secret.
- A contact is represented by one card. In each currency, gross receivable (**Te debe**) and gross payable (**Le debes**) remain separately visible. If both are positive in the same currency, show **Posición mixta en [currency]**; never duplicate the contact, hide one side, or replace gross values with a net balance.
- The v1 currency allowlist is **CUP, USD, EUR**, each with **scale 2**. Reject unlisted currencies and precision beyond two decimal places; do not silently round or convert.
- V1 is **owner-only**. Only the authenticated owner of a book may read or mutate it. Delegated members and membership roles are excluded.

These three product decisions were explicitly approved by the owner on **2026-11-21** and are binding for v1 unless a later owner decision changes them.

## 2. Server trust boundary

All write operations pass through a trusted server boundary (for example, an authenticated Edge Function calling private database operations). No browser-side direct table CRUD is allowed.

1. Obtain the authenticated user from a verified Supabase session/token. Never accept actor_user_id, owner_user_id, or book_id as authorization evidence from the request body.
2. Resolve the actor's book on the server.
3. Resolve the target book by its owner relation and require `auth.uid() = financial_books.owner_user_id`. Reject a caller who is authenticated but is not the owner, including global CuevaCoin administrators. Do not accept actor, owner or book IDs from the request body as authorization evidence.
4. Only after authentication and owner authorization, use the trusted server database connection. Its service-role credential stays server-side.
5. Keep all FORTUNA objects in a non-exposed schema. anon and authenticated get no direct schema/table grants. RLS remains enabled as defense in depth and must scope any permitted read to the owner. V1 has no membership table or member-based policy.
6. Return a minimal result: event ID, resulting per-currency positions, allocations, excess classification, and idempotency replay indicator. Never return secrets or unrelated profile data.

A privileged function must not rely on SECURITY DEFINER as a shortcut. If a later implementation genuinely requires one, isolate it in the private schema, pin the search path, check inside its body that `auth.uid()` owns the target book, minimize grants, and run Supabase advisors.

## 3. Command surface proposal

Names below describe server commands, not endpoints already implemented.

| Command | Purpose | Writes |
|---|---|---|
| create_contact | Create an external contact or link a verified profile | Contact + audit |
| open_obligation | Recognize a receivable or payable and its original amount | Obligation + event + ledger + audit |
| preview_settlement | Preview FIFO/manual application and any excess | None |
| receive_cash | Record money actually received from a contact | Event + allocations + ledger + audit |
| pay_contact | Record money actually delivered to a contact | Event + allocations + ledger + audit |
| compensate_obligations | Offset two open opposite obligations for the same contact/currency | Event + two allocations + two ledger entries + audit |
| reverse_event | Correct a prior event with a reason and bounded inverse lines | Reversal event + inverse allocations/ledger + audit |
| get_contact_position | Read gross receivable/payable and signed position per currency | None |
| get_book_summary | Read global totals grouped by currency and direction | None |

Every command that writes financial state must use a caller-supplied idempotency key and a server-computed canonical payload hash. Read/preview commands do not reserve idempotency keys and do not write any financial record.

## 4. Idempotency protocol

The current prototype stores idempotency by (book_id, actor_user_id, idempotency_key). The request hash is immutable.

1. Canonicalize the command name, API version, target IDs, currency, integer minor-unit amounts, allocation choices, excess confirmation, and any reversal/compensation reason. Exclude transport-only data such as request timestamps.
2. Hash the canonical payload on the server with SHA-256. Do not trust a hash supplied by the client.
3. Inside the same database transaction as the financial command, attempt to insert the idempotency row in processing state.
4. If the unique key already exists, lock and read that row:
   - Same hash + committed: return the stored response exactly; do not create new events or entries.
   - Different hash: return a conflict; never reinterpret the old key as a new command.
   - A visible processing row should not normally survive because reservation and commit are one transaction. If it does, treat it as an integrity/recovery condition; do not run the financial command a second time blindly.
5. On success, insert all domain rows and store the response while changing the idempotency row to committed.
6. Commit once. Any error rolls back the idempotency reservation, event, ledger, allocations and audit together.

A committed idempotency row is immutable. The only permitted update is the single server-side processing → committed transition. The book, actor, key, hash, and created timestamp cannot change.

## 5. Common transaction envelope

Every financial write follows the same sequence:

1. Begin a PostgreSQL transaction.
2. Verify the actor and authorize the book/action on the server.
3. Reserve or replay the idempotency key.
4. Lock the book/contact and then all affected obligations in deterministic order (for example, UUID ascending). Every writer must use the same lock order.
5. Recompute balances from committed ledger rows after locks are acquired. Never trust an old preview as the final balance.
6. Validate the currency against the v1 allowlist (CUP/USD/EUR, scale 2), parse exact integer minor units, and reject extra precision or unsupported currencies. Then validate positive amounts, ownership, event semantics, remaining obligation, allocations, excess confirmation and reversal limits.
7. Insert the event header, allocation rows, signed ledger entries, and audit evidence.
8. Reconcile each affected obligation and the contact/currency position from the ledger.
9. Store the idempotent response and mark the key committed.
10. Commit. If any step fails, roll back everything.

Never update/delete a confirmed financial event, obligation, allocation, ledger entry, or audit row. An archive or status display may be derived, but it must not erase accounting evidence.

## 6. Settlement preview and confirmation

A preview is read-only. It returns:

- the gross cash amount in integer minor units and one currency;
- candidate obligations in FIFO order (opened_at, then stable ID);
- suggested or user-selected manual allocations;
- the outstanding amount before and after each proposed allocation;
- the residual excess, if any;
- whether the excess would create an opposite-direction obligation after confirmation;
- a deterministic preview fingerprint for stale-preview detection.

At confirmation, the server locks all affected obligations and rebuilds the allocation plan. If the underlying balances changed since preview, return a stale-preview response with a fresh preview; do not apply the old plan.

The confirmation must include an explicit excess acknowledgement when excess is positive. The server rejects an allocation sum above the cash amount or above the current outstanding amount of any obligation.

### Direction table

| Real cash movement | First applied to | Confirmed excess creates |
|---|---|---|
| Owner receives money | Receivables | A new payable to the contact |
| Owner pays money | Payables | A new receivable from the contact |

The cash event is a record of money actually received/delivered; opening an obligation alone never moves cash.

## 7. Operation-specific invariants

### 7.1 Open obligation

- The amount is positive integer minor units and uses the currency's approved scale.
- Require a non-empty description; due date is optional.
- Store original direction and principal once.
- Add a positive ledger line for a receivable or a negative line for a payable.
- The current outstanding amount starts at the original signed amount.

### 7.2 Receive cash / pay contact

- Only opposite-direction open obligations may be settled by that cash movement.
- Recalculate outstanding amounts after row locks.
- Each application is positive and cannot exceed the target obligation's current open amount.
- FIFO is a suggestion, while manual allocation must pass the same bounds.
- If cash exceeds all eligible open obligations, do not silently discard, convert, or assign it. Require explicit excess confirmation and create a new opposite-direction obligation for the exact residual.
- Insert one event header, one allocation row per affected obligation, and one signed ledger line per affected obligation. If an excess obligation is created, it is also represented in the same transaction.

### 7.3 Compensation

- The two obligations must belong to the same book, contact and currency and have opposite directions.
- Lock both obligations in stable ID order.
- The compensation amount cannot exceed the smaller current outstanding amount.
- Insert one compensation event, two allocation rows and two equal-magnitude ledger lines with opposite signs.
- The signed net position for that contact/currency is unchanged; the two gross outstanding amounts each decrease.
- No cash is created or moved. Cross-contact or cross-currency compensation is rejected.

### 7.4 Reversal

- The target event must exist in the same book, contact and currency and must not itself be a reversal.
- Require a non-empty reason and an authorized actor.
- Lock the source event and every affected obligation in stable order.
- Reconstruct the source event's ledger effects by obligation. Existing reversals of that source reduce its remaining reversible amount.
- New reversal ledger lines must be exact inverse signs of the source event's remaining lines and must never exceed the unreversed amount for any obligation.
- The resulting outstanding amount of every obligation must remain zero or in its original direction. If reversing an opening obligation would make its balance cross through zero because it was already settled, first reverse the dependent settlement(s); then the opening event can be reversed safely.
- If the source was a compensation, reverse both sides by the same magnitude in the same transaction; a one-sided compensation reversal is invalid.
- Record corresponding reversal allocation rows for reversed source allocations. Preserve the source event and all prior evidence.

### 7.5 Read models

Use signed ledger entries as the position source of truth.

For each obligation, derive remaining signed amount by summing its ledger entries. The sign must remain consistent with the obligation's original direction or be zero. For each contact/currency, derive:

- gross receivable = sum of positive open obligation balances;
- gross payable = absolute sum of negative open obligation balances;
- signed position = receivables minus payables.

Book summary groups by currency and direction. A contact read model returns one contact card with separate gross receivable and gross payable amounts for every currency. If both sides are positive in one currency, label that currency row **Posición mixta en [currency]**; do not duplicate the contact or present a net amount as a substitute. Do not produce a cross-currency net amount or infer a conversion rate.

## 8. Prototype refinements required before migration

Review of PR #39's fixture identified three structural gaps now addressed in this branch:

1. Every ledger entry must reference an obligation. A position-bearing line without an obligation cannot be reconciled to its source debt.
2. Each event has one aggregated ledger line per obligation; duplicate lines make reversal limits and reconciliation harder to prove.
3. Every event must carry a positive gross total_amount_minor, so the system can retain the amount the owner actually recorded independently of how many ledger lines it produces. Compensation has two opposite ledger lines but one gross event amount.

The isolated SQL fixture and verifier in this PR add these three constraints. They remain test-only changes, not production DDL.

The server must also enforce aggregate rules that cannot be expressed as simple row constraints: allocations cannot exceed an event's gross amount (except that two-sided compensation represents the same gross amount on both obligations), no obligation may be over-settled, reversals cannot exceed the unreversed event effects, and all ledger lines must reconcile.

## 9. Required integration tests before production

The PGlite single-connection harness proves DDL and local constraints but cannot prove multi-connection races, Supabase JWT, Edge authorization or actual Data API exposure.

Before a real migration/API is considered ready, add an isolated integration suite for:

- owner A can read and mutate only owner A's book; owner B, any authenticated non-owner (including global admin), and anon are denied;
- same key + same payload returns one original result and creates no second event;
- same key + different payload returns conflict;
- two concurrent settlements against the same obligation cannot apply more than its remaining amount;
- concurrent retry of the same idempotency key creates exactly one financial event;
- stale settlement preview is rejected and requires reconfirmation;
- CUP, USD and EUR accept at most two decimal places; unsupported currencies and higher precision are rejected without silent rounding;
- a same-currency mixed contact is returned as one card with separate gross receivable/payable values, never a hidden or netted side;
- overpayment without explicit acknowledgement creates no records;
- compensation validates same contact/currency and updates both obligations atomically;
- partial reversal is bounded per source event/obligation; full reversal cannot flip an outstanding obligation through zero;
- a compensation reversal is paired on both sides;
- injected mid-transaction failure leaves no event, ledger, allocation, audit or committed idempotency result;
- ledger-derived obligation balances and gross totals reconcile after each case;
- no row in perfiles.saldo, transacciones, payroll, or cash-related tables is changed.

Use a free isolated PostgreSQL/Supabase test target if available. Do not use CuevaCoin LIVE as a test database, do not open a paid Supabase branch, and do not use real financial records as test fixtures.

## 10. Approved product decisions and remaining engineering gates

The owner explicitly approved these v1 product decisions on **2026-11-21**:

1. **Same-currency mixed obligations:** one card per contact, with gross receivable (**Te debe**) and gross payable (**Le debes**) shown separately per currency. When both exist for the same currency, label that row **Posición mixta en [currency]**. Never duplicate the contact or silently net/hide either side. Compensation is always a separate explicit operation.
2. **Currency allowlist:** CUP, USD and EUR only, each at scale 2. Amounts use exact integer minor units; reject unsupported currencies and precision beyond two decimals without silent rounding. No FX conversion.
3. **Authorization:** owner-only. Resolve the owner from the verified session and the book row; other authenticated users, global CuevaCoin admins who are not the book owner, and anon are denied. No membership table, operator role or read-only delegate in v1.

These are closed product gates. The following are still engineering prerequisites before production schema/API work:

- A real PostgreSQL multi-connection integration suite must demonstrate two concurrent settlements cannot over-apply the same obligation and concurrent retries of one idempotency key create exactly one event. PGlite's single connection does not prove this.
- An isolated Supabase integration suite must verify verified-session identity, owner-only authorization, RLS/grants, private-schema behavior, Data API exposure and the actual Edge/server trust boundary.
- The final schema and indexes require review, executable tests and Supabase advisors before a migration PR is considered ready.
- Production deployment or LIVE DDL requires a separate explicit Human Gate.

Retention, reports, reminders and cash-register integration remain outside v1.

## 11. Safety scope

This document and fixture do not create a migration under supabase/migrations/, do not execute SQL against Supabase, and do not deploy RPC/Edge code or UI. No secrets, production financial events, balances, transfers, payroll entries or cash records are changed.
