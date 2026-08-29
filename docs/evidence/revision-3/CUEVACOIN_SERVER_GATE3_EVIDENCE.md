# CUEVACOIN GATE 3 — LIVE EVIDENCE SNAPSHOT

## Project identity
- Name: CuevaCoin
- Ref: zqgmjwfvluboiporytcq
- Organization: slytrsaxmsqmqwakkhfl
- Region: ca-central-1
- Status: ACTIVE_HEALTHY
- DB version: PostgreSQL 17.6 / Supabase reported 17.6.1.155

## Security advisor
Confirmed warnings included:
- `public.proteger_columnas_sensibles_perfil` — mutable search_path
- `public.es_admin` — mutable search_path
- `public.admin_pagar_saldo(...)` — anon/authenticated executable SECURITY DEFINER
- `public.admin_resolver_retiro(uuid,text)` — anon/authenticated executable SECURITY DEFINER
- `public.admin_resolver_retiro(uuid,boolean)` — anon/authenticated executable SECURITY DEFINER
- `public.avisar_meta_ahorro_alcanzada()` — anon/authenticated executable SECURITY DEFINER
- `public.es_admin()` — anon/authenticated executable SECURITY DEFINER
- `public.solicitar_retiro(...)` — authenticated executable SECURITY DEFINER
- leaked-password protection disabled

## Effective EXECUTE checks
- anon -> admin_pagar_saldo: TRUE
- authenticated -> admin_pagar_saldo: TRUE
- anon -> admin_resolver_retiro(uuid,text): TRUE
- authenticated -> admin_resolver_retiro(uuid,text): TRUE
- anon -> admin_resolver_retiro(uuid,boolean): TRUE
- authenticated -> admin_resolver_retiro(uuid,boolean): TRUE
- anon -> solicitar_retiro: FALSE
- authenticated -> solicitar_retiro: TRUE

## Financial indexes
- perfiles_numero_cuenta_key UNIQUE(numero_cuenta)
- perfiles_pkey UNIQUE(id)
- perfiles_usuario_key UNIQUE(usuario)
- solicitudes_retiro_pkey UNIQUE(id)
- ux_solicitudes_retiro_idempotency_key UNIQUE(idempotency_key) WHERE idempotency_key IS NOT NULL
- ux_solicitudes_retiro_un_pendiente_por_usuario UNIQUE(usuario_id) WHERE estado='pendiente'
- transacciones_pkey UNIQUE(id)

## RLS
RLS enabled:
- perfiles: YES
- solicitudes_retiro: YES
- transacciones: YES
- notificaciones: YES
- auditoria: YES

## Transfer edge function — sanitized evidence
Function: transferir-saldo
Version: 8
Status: ACTIVE
verify_jwt: true

Financial flow observed:
1. authenticate JWT
2. read sender balance
3. read recipient balance
4. calculate absolute new balances
5. update sender
6. update recipient
7. insert two transaction rows
8. insert notification
9. send push
10. insert audit record

Missing:
- idempotency key
- SQL transaction boundary
- row lock on sender
- server-side deduplication
- UNIQUE operation identity

## Sensitive material intentionally omitted
The live Edge Function source contains credential-like material unrelated to the financial proof. It is not reproduced here.