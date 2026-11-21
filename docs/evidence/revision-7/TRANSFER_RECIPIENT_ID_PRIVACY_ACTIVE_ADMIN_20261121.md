# CuevaCoin — Recipient ID privacy and active-admin withdrawal guards
Date: 2026-11-21

## Scope and source of truth
This change was prepared from read-only inspection of Supabase project `zqgmjwfvluboiporytcq` and repository `main` after migration-ledger PR #35 was merged.

LIVE Edge Function baselines recovered and versioned in this repository:
- `transferir-saldo`: ACTIVE v11; already accepts `destinatarioId` and calls `transferir_saldo_atomica`.
- `resolver-cuenta-qr`: ACTIVE v3.
- `resolver-cuenta-usuario`: ACTIVE v3.

The two recipient lookup Edge Functions are changed in this branch to select and return an internal profile ID plus display fields only. They no longer select or return the recipient email. The transfer Edge Function preserves its ID route and email fallback solely so pre-V157 offline queue items can still replay.

## Frontend contract
- Recipient search uses the additive `resolver_destinatario_transferencia_v2(text)` RPC.
- The new resolver returns `id, usuario, nombre, apellido, estado`; it never returns email. Duplicate display-name matches are rejected; users must enter an exact username or email rather than risk selecting an arbitrary recipient.
- QR, username lookup, favorites, password confirmation, and online transfer execution carry the stable profile ID.
- New offline queue entries store the profile ID. Existing email-only queue records retain a compatibility replay route.
- The visible transfer field accepts an identifier but shows the recipient's display name/username after resolution.
- The previous `const destinatarioCorreo` reassignment bug in the legacy form is removed.
- The application release and service-worker shell cache advance to V157.

## Withdrawal authorization
The exact LIVE definitions of both overloads were read:
- `admin_resolver_retiro(uuid, boolean)`
- `admin_resolver_retiro(uuid, text)`

Both were SECURITY DEFINER and checked `es_admin = true`, but did not require `perfiles.estado = 'activo'`. The forward migration preserves their transaction, row-lock, trusted-balance-write, notification and audit behavior while adding an active-admin guard to both overloads.

## Compatibility and rollout caveat
The old `resolver_destinatario_transferencia(text)` RPC is deliberately retained for older clients during rollout. It still returns email until a separate retirement change is authorized after app adoption is verified. The old LIVE versions of the QR and username resolver functions also continue to return email until the new function sources are deployed. This PR does **not** claim the privacy issue is already removed from LIVE.

Deployment order, each requiring a separate Human Gate:
1. Review and explicitly authorize the forward migration; do not replay historical migrations.
2. Deploy the versioned Edge Function sources to the fixed project, preserving the current JWT verification settings.
3. Deploy the V157 app/Worker release and verify ID-only transfer paths, QR, favorites and offline replay.
4. Check adoption and then prepare a separate retirement/revocation of the legacy email-returning RPC.

## Validation
- The focused static verifier checks ID-only client calls, no email in new lookup outputs, legacy queue replay compatibility and JavaScript syntax.
- The read-only SQL catalog test checks the ID-only RPC result signature, role access and both active-admin guards.
- The original 65-version migration baseline and all 58 recovered-source SHA-256 checks remain intact; this branch adds one explicitly recorded forward migration.
- No SQL was executed. No balances, transactions, withdrawal requests, permissions, RLS, secrets, Edge Functions or Worker deployment were changed in LIVE.
