# FORTUNA v1 — UI preview shell

**Status:** first UI shell implemented; preview only. No production activation is authorized by this change.

## Scope
- Adds an administrator sidebar entry and a responsive FORTUNA page with Overview, Contacts and History tabs.
- Shows the approved product vocabulary: receivables ("Te debe"), payables ("Le debes"), mixed positions with both gross sides visible, and the CUP/USD/EUR allowlist.
- Displays em dashes for financial totals. These mean "not queried", not zero balances.
- Keeps contact creation, obligation creation, search and currency filters disabled.

## Security boundary
- The preview module imports no data client, issues no fetch requests, calls no RPC and writes no storage.
- The module shows no production data, sample financial records, test contacts or simulated balances.
- The navigation item is shown only in the administrator panel and hidden in the worker panel. This is a preview visibility rule, not the final owner authorization mechanism.
- The actual book remains owner-only as specified in `FORTUNA_V1_PRODUCT_DECISIONS.md`; no UI state or global CuevaCoin administrator role grants book access.
- Do not enable API reads/writes or the action buttons until hosted Auth/JWT and owner-A/owner-B isolation have passed in an authorized isolated target.

## Verification
Run `node scripts/verify-fortuna-ui-preview.mjs`. The GitHub-hosted preview workflow runs on trusted `feat/fortuna-ui/**` pushes and has read-only repository permissions.


## Iteration 2 — local-only workflow workbench (V160)

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
