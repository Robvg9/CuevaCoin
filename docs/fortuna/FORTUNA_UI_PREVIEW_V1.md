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
