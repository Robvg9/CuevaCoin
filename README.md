# CuevaCoin

CuevaCoin is maintained as a modular web application.

## Structure

- `index.html` — modular application shell.
- `js/` — organized application modules by responsibility.
- `service-worker.js` / `manifest.json` — PWA infrastructure.
- `docs/evidence/` — historical forensic and release evidence.

## Current status

The modular RC has been consolidated into `main`. The server-side transfer race/idempotency blocker remains a separate backend task and is intentionally not claimed as fixed by this repository consolidation.
