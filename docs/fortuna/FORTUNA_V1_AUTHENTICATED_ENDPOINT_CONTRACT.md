# FORTUNA v1 — Authenticated Edge/API endpoint contract

**Estado:** documento de diseño histórico. El contrato de transporte propuesto en este archivo quedó supersedido por la implementación desplegada y documentada en [FORTUNA Edge Dispatcher — v1](./edge-dispatcher.md). Las secciones siguientes preservan decisiones de dominio y controles de seguridad propuestos; no deben interpretarse como la ruta HTTP activa ni como prueba de que todas las operaciones descritas ya existen.
**Design base:** `main` SHA `bd98f321dbd1bde790854a3f47273697eef2bcd9`.
**Depends on:** product decisions, atomic transaction design, owner-only RLS gate, and the test-only API/private boundary prototype.

> **Checkpoint actual — 2026-11-22/23:** el API schema y los permisos mínimos fueron activados en Supabase LIVE. El Human Gate independiente para desplegar `fortuna-dispatch` fue APROBADO. La función está ACTIVE v2 con `verify_jwt=true`; su fuente coincide byte por byte con GitHub main SHA `cf593244722eca6c85861948e8bbce907b323a1f`. La ruta actualmente desplegada es `POST /functions/v1/fortuna-dispatch` y su envelope es `{"operation":"list_contacts","args":{}}`. No se desplegó la antigua ruta propuesta `/functions/v1/fortuna-v1`. Primer smoke real: una petición sin Authorization devolvió `401 AUTH_REQUIRED`; los logs muestran que llegó al handler, que bloqueó antes de Auth/RPC. Esto es compatible con la guía actual de Supabase: `verify_jwt` acepta claves publishable/secret en `apikey` por compatibilidad, pero esas claves no autentican una persona. La guardia explícita del handler `AUTH_REQUIRED` es la que detuvo la petición antes de `auth.getUser()` y RPC; los Bearer presentes se validan con `auth.getUser()`. Mantener `verify_jwt=true` y no confundir la clave pública con el JWT de sesión. Referencia: https://supabase.com/docs/guides/functions/auth-headers. El Hosted authenticated E2E owner-A/owner-B sigue OPEN; tampoco se ha conectado la UI FORTUNA ni se han creado registros financieros en LIVE.

## 1. Decision for the v1 request path

Use one authenticated Edge Function as the transport façade and one database RPC per command:

`CuevaCoin client → POST /functions/v1/fortuna-v1 → Edge JWT verification → user-scoped Supabase context → api.<allowlisted RPC> → fortuna_private.<transaction helper> → private tables`

**Historical proposal only:** the `/functions/v1/fortuna-v1` route and the request envelope described in sections 3–7 below were a design proposal. The active endpoint is `/functions/v1/fortuna-dispatch`; its exact code is the source of truth for transport behavior. See [edge-dispatcher.md](./edge-dispatcher.md).

- The deployed Edge Function is user-facing and has `verify_jwt=true`.
- The handler validates the caller's bearer token with `auth.getUser(jwt)` before dispatch.
- The same user JWT is forwarded through the public-key Supabase client when it calls `.schema('api').rpc(...)`.
- PostgreSQL remains the authorization and transaction authority: every private operation derives the actor from `auth.uid()`, resolves the owner's book itself, and verifies every referenced resource belongs to that book.
- No `service_role`, secret key, shared privileged database role, or client-supplied identity is used as authority.

This path is preferred over a shared direct-Postgres Edge connection. Direct Postgres remains an unselected alternative and would require a separate role, claims-per-transaction, pooling, prepared-statement, and credential review.

## 2. Supabase schema and grants boundary

The API schema is a narrow function surface, not a place for tables.

- The owner confirmed that `api` is included in the Data API Exposed Schemas allowlist, retaining `public` and `graphql_public` and keeping `fortuna_private` excluded. The current allowlist cannot be independently read through the available Supabase database connector; this item is recorded as owner-confirmed Dashboard state.
- The approved grant `GRANT USAGE ON SCHEMA api, fortuna_private TO authenticated` was applied successfully to hosted Supabase.
- Post-grant catalog verification: `authenticated` has schema USAGE on `api` and `fortuna_private`; `anon` has no USAGE on either schema.
- The seven `api` wrappers are `SECURITY INVOKER`; EXECUTE is granted to `authenticated` and denied to `anon`.
- All nine private FORTUNA tables retain no direct SELECT/INSERT/UPDATE/DELETE privileges for either `authenticated` or `anon`.
- Do not broaden table grants. Keep function-level EXECUTE grants as the callable database surface.

Important distinction: grants determine whether a role can reach a database object; Postgres RLS determines which rows a caller can access. Function RPC access is controlled by EXECUTE grants, and RLS does not automatically secure a function. Review both controls and every definer helper.

## 3. HTTP transport contract — historical proposal, not active

**Proposed route (not deployed):** `POST /functions/v1/fortuna-v1`.  
**Active route:** `POST /functions/v1/fortuna-dispatch`; see [edge-dispatcher.md](./edge-dispatcher.md).  
**Active request envelope:** `{"operation":"<allowlisted operation>","args":{...}}`.

The active handler delegates RPC argument validation and transaction semantics to the reviewed database wrappers. The old `version/command/idempotency_key/data` envelope below is not the transport consumed by the deployed handler.

```json
{
  "version": 1,
  "command": "open_obligation",
  "idempotency_key": "client-generated-unique-key",
  "data": {
    "contact_id": "uuid",
    "direction": "receivable",
    "currency": "CUP",
    "amount_minor": "12500",
    "description": "Préstamo acordado"
  }
}
```

The domain-level requirements below remain design constraints where implemented by the actual RPCs, not proof of additional API routes or commands.

- Amounts use integer minor units; do not use floating-point values as the exact monetary source.
- The initial currency set is CUP, USD, and EUR at scale 2.
- Never accept `owner_user_id`, `actor_user_id`, `user_id`, or `book_id` as authorization evidence.
- A settlement preview is read-only. Any confirmation write must revalidate and lock the affected obligations in one database transaction.

## 4. Command surface proposal

The original list below remains a product/API backlog, not a claim that all proposed commands are deployed.

| Command | Mode | Purpose |
|---|---|---|
| `get_book_summary` | Read | Gross receivable/payable totals per currency |
| `list_contacts` | Read | One contact per card, with per-currency gross positions |
| `get_contact_detail` | Read | Contact, open obligations, event history, and allocations |
| `list_book_events` | Read | Paginated immutable event history |
| `preview_settlement` | Read-only preview | FIFO suggestion or manual plan, open balances, excess, and fingerprint |
| `create_contact` | Write | Create an external contact |
| `update_contact` | Write | Update allowed descriptive fields; audit the change |
| `archive_contact` | Write | Archive without deleting accounting history |
| `open_obligation` | Write | Recognize a receivable or payable |
| `receive_cash` | Write | Record cash actually received, apply to receivables, and require excess confirmation |
| `pay_contact` | Write | Record cash actually delivered, apply to payables, and require excess confirmation |
| `compensate_obligations` | Write | Explicit same-contact, same-currency opposite-direction compensation |
| `reverse_event` | Write | Linked, reasoned, bounded reversal; never edit/delete the source event |

The actual deployed dispatcher exposes only the seven operations listed in [edge-dispatcher.md](./edge-dispatcher.md). Do not add a generic arbitrary-SQL or generic table CRUD endpoint.

## 5. Write transaction contract

Every write RPC must execute the entire command atomically:

1. Require authenticated `auth.uid()`; resolve the current book by owner relation inside the database.
2. Validate that all referenced resources belong to that book. Do not reveal whether another owner's resource exists; return a non-enumerating not-found/forbidden result.
3. Canonicalize command + API version + resource IDs + currency + amount strings converted to exact integer minor units + allocation choices + confirmations + reason. Exclude transport metadata.
4. Compute the canonical SHA-256 payload hash on the server. Never trust a client-provided hash.
5. Reserve/replay the idempotency key inside the same transaction. Same key + same hash + committed returns the stored response without creating additional rows. Same key + different hash returns conflict without writes.
6. Lock the book/contact and affected obligations in a deterministic order. Recompute all open amounts from the committed ledger after locks are acquired.
7. Validate direction, currency/precision, allocations, settlement bounds, preview freshness, excess confirmation, compensation pairing, and reversal limits.
8. Insert the immutable event, allocations, signed ledger lines, and audit record; create any confirmed excess obligation within the same transaction.
9. Reconcile obligation balances and contact/currency gross totals from the ledger.
10. Store the response and mark the idempotency record committed, then commit once. Any failure rolls back every write in the command.

No function may update/delete a confirmed financial event, allocation, ledger line, or audit evidence. Corrections are linked inverse events. A reversal of compensation must reverse both sides together.

## 6. Settlement confirmation rules

The preview must show the gross cash amount, eligible obligations, proposed FIFO/manual allocations, each remaining balance, residual excess, and the direction of the obligation that excess would create.

- Receiving money applies first to receivables. Confirmed excess creates a payable.
- Paying money applies first to payables. Confirmed excess creates a receivable.
- A positive excess without an explicit acknowledgement is rejected before any write.
- A changed preview fingerprint returns `STALE_PREVIEW`; the client must show a fresh preview and obtain confirmation again.
- FIFO is only a suggestion; a manual plan remains allowed if it passes the same server-side limits.

## 7. Response and error contract — historical proposal

The response/error examples and stable error-code list in this section describe the original design proposal. The active dispatcher currently sanitizes gateway/Auth/PostgREST failures into transport-level errors; the RPCs own their domain-level result shape. Keep this section as a target contract until reconciled against actual wrapper definitions and responses.

## 8. Security and integration acceptance gates

The following acceptance criteria remain relevant. Hosted checks must use a dedicated, authorized test target and test identities; never create financial test entries in the production book.

1. Edge gateway rejects no JWT, malformed JWT, wrong-project JWT, expired JWT, and revoked/deleted user as applicable; valid JWT reaches handler.
2. Edge handler uses a caller-scoped client and never constructs or calls an admin/service-role client for FORTUNA.
3. A caller cannot select another actor/book by adding `owner_user_id`, `actor_user_id`, `user_id`, or `book_id` to any payload.
4. Owner A can access only A's data; owner B and a global CuevaCoin admin who is not the book owner are denied.
5. `fortuna_private` is absent from Data API Exposed Schemas; only the intentional `api` RPC surface is exposed.
6. Direct table access is denied to `anon` and `authenticated`; unapproved function EXECUTE is denied, including inherited PUBLIC grants.
7. Two concurrent settlements cannot exceed an obligation's open amount; duplicate same-key requests create one event; a changed payload under the same key is rejected.
8. Failure injection between writes leaves no partial event, allocation, ledger, audit, excess obligation, or committed idempotency row.
9. Preview drift forces a fresh preview; excess requires explicit confirmation; compensation/reversal invariants remain paired and bounded.
10. FORTUNA has zero writes to CuevaCoin wallet balances, transfers, payroll, cash, inventory, and other business records.

PGlite manually sets a JWT subject claim; the Native PostgreSQL harness checks database concurrency. Neither proves real Supabase Auth/JWT verification, hosted Data API exposure, or Edge Runtime. Hosted authenticated E2E remains OPEN until an authorized isolated zero-cost target and test identities are available. Do not create a paid branch/project or reuse CuevaCoin, BattleCruiser, or SimpleLife production projects.

## 9. Rollout status

- The API schema allowlist and minimum grants have been activated in CuevaCoin LIVE.
- The separate Human Gate for the Edge dispatcher was approved; `fortuna-dispatch` is deployed ACTIVE v2 with `verify_jwt=true`.
- The deployment source hash/version is recorded in [edge-dispatcher.md](./edge-dispatcher.md).
- Hosted authenticated E2E remains OPEN. It requires a zero-cost isolated target and two test identities; no financial test records may be created in CuevaCoin production.
- The FORTUNA financial UI remains unconnected until the hosted authenticated E2E acceptance gate passes.
- Production financial entries and any real financial movement still require their own explicit authorization.

## 10. References

- [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Authorization headers and verify_jwt](https://supabase.com/docs/guides/functions/auth-headers)
- [Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [Using Custom Schemas](https://supabase.com/docs/guides/api/using-custom-schemas)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
