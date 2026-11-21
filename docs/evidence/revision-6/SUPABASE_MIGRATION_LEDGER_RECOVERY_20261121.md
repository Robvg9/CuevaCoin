# CuevaCoin — Supabase migration ledger source recovery

Date: 2026-11-21  
Project: `zqgmjwfvluboiporytcq`  
Source: `supabase_migrations.schema_migrations` in the live CuevaCoin database  
Scope: historical migrations before Step 10

## Provenance and method

The original SQL was recovered from the database migration ledger's `statements[1]` value for each recorded migration. This is the original stored migration statement, not SQL reconstructed from the current schema. The 58 historical rows each had one non-empty statement. The ledger's `rollback` column was NULL for these rows; no rollback scripts were fabricated.

The seven later migration files already tracked in the repository were reconciled separately. Six matched the ledger SQL byte-for-byte. The remaining index migration differs only in comments/formatting, with the same CREATE INDEX statement. The salary migration filename was aligned to its LIVE ledger version in this PR.

## Safety

- Recovery writes source files only; it does not execute any SQL.
- Do not re-apply these migrations to CuevaCoin LIVE.
- Do not use `db reset` or `db push` as a repair operation.
- Before using this history to provision a fresh database, validate the complete sequence against a disposable local PostgreSQL/Supabase environment and compare the resulting schema, policies, functions, triggers, extensions, Storage configuration, and grants.
- The ledger preserves the statements that were recorded as applied; it does not prove that every historical file is independently replayable on a blank project without Supabase-managed prerequisites.

## Recovered historical migrations

| Version | Name | SQL characters |
|---|---|---:|
| `20260801194832` | `cuevacoin_esquema_inicial` | 4723 |
| `20260801203412` | `permitir_ver_perfiles_de_admins` | 409 |
| `20260801235122` | `agregar_campos_perfil_validacion` | 249 |
| `20260802001452` | `proteger_columnas_sensibles_perfil` | 1155 |
| `20260802025727` | `permitir_service_role_en_proteccion_saldo` | 418 |
| `20260802031600` | `crear_tabla_push_suscripciones` | 1120 |
| `20260802122322` | `crear_bucket_fotos_perfil` | 1823 |
| `20260802122336` | `corregir_policy_lectura_fotos_perfil` | 572 |
| `20260802125849` | `agregar_preferencias_notificaciones_perfiles` | 262 |
| `20260802131705` | `agregar_mensaje_chat_a_preferencias_notificaciones` | 442 |
| `20260802154431` | `habilitar_realtime_tabla_chat` | 58 |
| `20260802185735` | `permitir_insert_notificaciones_trabajador_a_admin` | 872 |
| `20260802190551` | `habilitar_realtime_notificaciones` | 347 |
| `20260803200948` | `chat_grupal_y_privado_38a_38b` | 2282 |
| `20260803204223` | `permitir_notificacion_privada_entre_contrapartes` | 1008 |
| `20260803212924` | `fix_chat_grupal_destinatario_nullable` | 67 |
| `20260803212929` | `permitir_ver_perfil_de_contraparte_transferencia` | 270 |
| `20260803234044` | `agregar_preferencias_privacidad_perfiles_41c` | 237 |
| `20260804010253` | `verificacion_correo_31` | 2000 |
| `20260804013812` | `proteger_correo_verificado_de_edicion_directa` | 857 |
| `20260804231247` | `quitar_verificacion_correo_de_policy_retiro` | 200 |
| `20260806011729` | `add_frase_personal_a_perfiles` | 263 |
| `20260806012349` | `add_color_acento_a_perfiles` | 376 |
| `20260806015850` | `add_meta_ahorro_a_perfiles` | 379 |
| `20260806103149` | `add_meta_ahorro_aviso_y_rpc_pagos` | 6396 |
| `20260806115244` | `actualizar_texto_aviso_meta_ahorro` | 867 |
| `20260806144606` | `add_solicitudes_retiro_a_realtime` | 65 |
| `20260806224512` | `agregar_respuesta_a_sugerencias` | 202 |
| `20260806230347` | `permitir_trabajador_marcar_respuesta_vista_sugerencias` | 981 |
| `20260806233115` | `agregar_tabla_favoritos` | 942 |
| `20260807000950` | `crear_tabla_solicitudes_cambio_correo` | 1666 |
| `20260807014837` | `agregar_perfiles_a_realtime_e4` | 62 |
| `20260807030627` | `borrar_tabla_huerfana_verificacion_correo_envios` | 55 |
| `20260807030643` | `agregar_tipo_evento_a_notificaciones_e5` | 76 |
| `20260807030743` | `agregar_tipo_evento_en_funciones_notificacion_e5` | 2976 |
| `20260807031703` | `rls_ver_perfiles_remitentes_chat_grupal_e12` | 568 |
| `20260807184820` | `policy_autoregistro_no_usada_directamente` | 450 |
| `20260807191306` | `crear_tabla_anuncio_app` | 1410 |
| `20260807191535` | `crear_tabla_contenido_bonos` | 1395 |
| `20260807222349` | `f_gmail_columnas_vinculacion_google` | 1078 |
| `20260808185408` | `agregar_duracion_horas_a_anuncio_app` | 319 |
| `20260809010244` | `notificar_mensaje_chat_grupal` | 947 |
| `20260809141810` | `retiro_rpc_atomico` | 5692 |
| `20260809142538` | `crear_admin_resolver_retiro_atomico` | 4134 |
| `20260825192235` | `secure_withdrawal_idempotency` | 2444 |
| `20260825234205` | `bug1_retiro_idempotency` | 2983 |
| `20260825234214` | `bug1_retiro_preserve_amount_validation` | 2328 |
| `20260825234230` | `bug1_withdrawal_idempotency_rpc` | 3391 |
| `20260829165722` | `atomic_transfer_idempotent` | 4026 |
| `20260829215051` | `retiros_idempotency_unique_pending_lock` | 304 |
| `20260830005538` | `harden_solicitar_retiro_idempotency_replay` | 2900 |
| `20260830123508` | `fix_retiro_reserva_saldo_v3` | 4954 |
| `20260830125423` | `fix_withdrawal_reservation_transaction_balances` | 2482 |
| `20260830132218` | `fix_trusted_balance_updates` | 11119 |
| `20260830134045` | `hfin_transfer_atomic_idempotent_v2` | 6627 |
| `20260830134121` | `hfin_transfer_rls_owner_access_fix` | 75 |
| `20260830144945` | `fix_transfer_recipient_lookup_by_username_and_email` | 1032 |
| `20260830160212` | `fix_resolver_destinatario_identificador_nombre` | 1188 |

Total recovered: **58 files**, 96,523 SQL characters.
