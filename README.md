# CuevaCoin

CuevaCoin is maintained as a modular web application.

## Structure

- `index.html` — modular application shell.
- `js/` — organized application modules by responsibility.
- `service-worker.js` / `manifest.json` — PWA infrastructure.
- `docs/evidence/` — historical forensic and release evidence.

## Current status

The modular RC has been consolidated into `main`. Transfer forensic reports in `docs/evidence/revision-3/` are historical: a later ChatBending checkpoint dated 2026-08-30 reports that `transferir_saldo_atomica` was deployed and that frontend idempotency-key integration was pending; the current frontend in `main` now sends `idempotencyKey`. Because current Supabase project access is unavailable from this repository workflow, revalidate the live RPC/Edge Function, idempotency table, grants and RLS before claiming the transfer subsystem is currently certified. Do not reapply the old proposed SQL blindly. Separately, the admin manual balance-adjustment path still needs atomic backend treatment.
