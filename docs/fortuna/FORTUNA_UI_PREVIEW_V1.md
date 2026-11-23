# FORTUNA v1 — UI preview shell

**Status:** first UI shell implemented; preview only. No production activation is authorized by this change.

## Scope
- Adds a shared authenticated-user sidebar entry and a responsive FORTUNA page with Overview, Contacts and History tabs.
- Shows the approved product vocabulary: receivables ("Te debe"), payables ("Le debes"), mixed positions with both gross sides visible, and the CUP/USD/EUR allowlist.
- Displays em dashes for financial totals. These mean "not queried", not zero balances.
- Contact and obligation creation run only as volatile local drafts; search and filters operate on those drafts.

## Security boundary
- The preview module imports no data client, issues no fetch requests, calls no RPC and writes no storage.
- The module shows no production data, sample financial records, test contacts or simulated balances.
- The navigation item is shown to both administrator and worker sessions because ownership is a user identity, not the global CuevaCoin admin role. The backend still authorizes the book through verified auth.uid().
- The actual book remains owner-only as specified in `FORTUNA_V1_PRODUCT_DECISIONS.md`; no UI state or global CuevaCoin administrator role grants book access.
- Do not enable API reads/writes or the action buttons until hosted Auth/JWT and owner-A/owner-B isolation have passed in an authorized isolated target.

## Verification
Run `node scripts/verify-fortuna-ui-preview.mjs`. The GitHub-hosted preview workflow runs on trusted `feat/fortuna-ui/**` pushes and has read-only repository permissions.


## Iteration 2 — local-only workflow workbench (V161)

- Adds contact and obligation draft dialogs, contact detail, search, currency filter, summary and preview history.
- Every item is volatile in-memory state for the current page only. Reloading or closing the tab removes the drafts.
- No Supabase client, fetch, RPC, localStorage, sessionStorage or IndexedDB is used; no event, ledger entry, audit row or idempotency row is created.
- Contact validation follows the backend limits: display name 1–120, phone ≤40, notes ≤1000 characters.
- Obligation validation follows the backend contract: receivable/payable, CUP/USD/EUR, strictly positive amount, up to two decimal places and description 1–500 characters.
- Money parsing uses string input plus `BigInt` minor units. Input is bounded before conversion, no floating-point arithmetic or rounding is used, and values are checked against PostgreSQL bigint maximum.
- Comma or point is accepted as the decimal separator; thousand separators and mixed separators are rejected to avoid ambiguous interpretation.
- Contact positions group by currency and retain separate gross "Te debe" and "Le debes" values; no netting or currency conversion occurs.
- This preview deliberately does not simulate cash settlement, allocations, overage or reversals. Those must use the backend preview fingerprint and transactional confirmation after hosted owner-isolation E2E passes.
- UI contract CI verifies the no-network/no-storage boundary, validation limits, maximum amount, two-decimal precision, mixed balances and currency isolation.


## Owner-only navigation correction

- The approved product decision is owner-only, not admin-only. The view now lives in the shared authenticated section (`shared-fortuna`) and is reachable by both administrator and worker sessions.
- `js/ui/navigation.js` routes `fortuna` through the shared-section allowlist; both session orchestrators reveal the same navigation entry after authentication.
- This is navigation only. It grants no book access. The backend resolves ownership exclusively from verified `auth.uid()`; a global CuevaCoin administrator who is not the book owner remains denied.

- PWA offline optimization: V161 precaches the versioned FORTUNA UI module and its domain helper in the service-worker shell, so the UI does not require a first-use network fetch after install/update.
## Iteration 3 — settlement handshake and amount-boundary hardening

- Local draft totals are checked against the PostgreSQL signed-bigint ceiling per currency and direction before an obligation draft is accepted. This prevents the preview from presenting a book total that the server's bigint aggregate cannot represent.
- The UI remains preview-only. No settlement button, Edge request, RPC call, or financial write is enabled in this iteration.

### Server contract for the future settlement UI

The existing authenticated dispatcher exposes these operations through POST /functions/v1/fortuna-dispatch and the caller's own JWT:

1. **preview_settlement** calls api.preview_settlement with contact ID, currency, flow (cash_received or cash_paid), mode (fifo or manual), total amount in integer minor units as a string, and a requested-allocations array.
2. The server returns the authoritative plan: version, contact, currency, flow, mode, total, eligible obligations, exact allocations, allocated total, overage, optional overage direction, and a 64-character SHA-256 preview_fingerprint. The browser displays this plan and never calculates or forges the fingerprint.
3. A separate explicit confirmation calls exactly one command: **receive_cash** for money received against receivables, or **pay_contact** for money paid against payables. It resends the same preview inputs plus the server-issued fingerprint, the explicit confirm-overage boolean, and one idempotency key.
4. The database locks the contact and eligible obligations, recalculates the plan, and rejects a stale fingerprint before any financial event is committed. If overage exists, the user must explicitly confirm it; the overage becomes a new obligation in the opposite direction.
5. The idempotency key is generated once for the confirmed payload. A retry with the same key and identical payload returns the original committed response; reusing that key with a different payload is a conflict (HTTP 409). Do not mint a new key for an uncertain retry of the same command.
6. The commit is one database transaction covering event, allocations, ledger entries, optional overage obligation, audit and idempotency result. The UI refreshes server state after success and clears the now-consumed preview.

### Mandatory UI rules

- Any change to contact, currency, direction, mode, amount or manual allocation invalidates the current preview and disables confirmation until a fresh server preview succeeds.
- FIFO sends an empty manual-allocation array. Manual mode sends one unique obligation ID per selected allocation, in the same contact/currency/direction scope.
- Show every server-returned allocation and the overage separately; never auto-confirm overage or imply that it is part of an existing obligation.
- A stale-preview response requires a new preview and a fresh user confirmation. Never retry the commit with a changed fingerprint under the old idempotency key.
- Keep the caller JWT end-to-end through Auth and PostgREST. Do not introduce a service-role key, direct private-schema access, browser-side ownership, or client-side ledger writes.
- Do not persist preview fingerprints or pending commit payloads in browser storage. Clear transient state on logout/account change.

**Verification boundary:** the SQL owner-settlement tests already cover FIFO ordering, exact retry replay, manual bounded allocations, stale-preview rejection, overage and owner isolation. The preview CI now asserts that the frontend integration contract still matches those server entry points and that the local amount aggregate cannot overflow. This static/isolated evidence does not substitute for the outstanding hosted authenticated owner-A/owner-B E2E gate.
