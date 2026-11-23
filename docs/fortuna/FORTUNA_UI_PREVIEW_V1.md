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
