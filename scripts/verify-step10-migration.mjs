import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const migrationPath = 'supabase/migrations/20261014161845_step10_p0_security_atomic_balance_adjustment.sql';
const migration = readFileSync(migrationPath, 'utf8');
const sqlChecks = [
  ['closes anonymous direct table grants', /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon/i],
  ['removes TRUNCATE from authenticated users', /REVOKE TRUNCATE, REFERENCES, TRIGGER[\s\S]*?FROM PUBLIC, anon, authenticated/i],
  ['hardens default table privileges for postgres', /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public[\s\S]*?REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated/i],
  ['hardens default function execution for postgres', /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public[\s\S]*?REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated/i],
  ['pins privileged function search_path', /ALTER FUNCTION public\.es_admin\(\)[\s\S]*?SET search_path = pg_catalog, public/i],
  ['enforces admin identity from auth.uid', /v_admin_id uuid := auth\.uid\(\)[\s\S]*?v_admin\.es_admin IS DISTINCT FROM true/i],
  ['requires positive integer amount', /p_cantidad <= 0 OR p_cantidad <> pg_catalog\.trunc\(p_cantidad\)/i],
  ['serializes idempotent retries via unique key', /ON CONFLICT \(idempotency_key\) DO NOTHING/i],
  ['locks target profile row', /FROM public\.perfiles AS p[\s\S]*?WHERE p\.id = p_usuario_id[\s\S]*?FOR UPDATE/i],
  ['prevents negative balance', /IF v_saldo_despues < 0 THEN[\s\S]*?Saldo insuficiente/i],
  ['writes ledger in same transaction', /INSERT INTO public\.transacciones[\s\S]*?RETURNING id INTO v_transaccion_id/i],
  ['writes notification and audit in same transaction', /INSERT INTO public\.notificaciones[\s\S]*?INSERT INTO public\.auditoria/i],
  ['stores replay evidence atomically', /UPDATE public\.admin_ajustes_saldo_idempotencia AS o[\s\S]*?completada = true/i],
  ['blocks anonymous RPC execution', /REVOKE EXECUTE ON FUNCTION[\s\S]*?public\.admin_ajustar_saldo_atomico[\s\S]*?FROM PUBLIC, anon/i],
  ['grants RPC to authenticated and service role', /GRANT EXECUTE ON FUNCTION[\s\S]*?public\.admin_ajustar_saldo_atomico[\s\S]*?TO authenticated, service_role/i],
  ['wraps schema changes in one transaction', /BEGIN;[\s\S]*COMMIT;\s*$/i],
];
for (const [label, pattern] of sqlChecks) {
  assert.match(migration, pattern, 'Missing invariant: ' + label);
  console.log('PASS — ' + label);
}
const testSql = readFileSync('supabase/tests/step10_security_invariants.sql', 'utf8');
assert.match(testSql, /has_table_privilege\('anon'.*'TRUNCATE'/is);
assert.match(testSql, /has_table_privilege\('authenticated'.*'TRUNCATE'/is);
assert.match(testSql, /admin_ajustar_saldo_atomico/);
console.log('PASS — live SQL verification script includes privilege and RPC assertions');
const rollbackTest = readFileSync('supabase/tests/step10_atomic_adjustment_rollback.sql', 'utf8');
assert.match(rollbackTest, /BEGIN;[\s\S]*ROLLBACK;\s*$/i);
assert.match(rollbackTest, /v_replay/);
assert.match(rollbackTest, /non-admin/i);
assert.match(rollbackTest, /STEP10_FORCE_ATOMIC_ROLLBACK_TEST/);
console.log('PASS — transactional test covers replay, authorization, and rollback without persistence');

const inactiveFinanceMigration = readFileSync(
  'supabase/migrations/20261020172209_block_admin_finance_on_inactive_profiles.sql',
  'utf8',
);
assert.match(
  inactiveFinanceMigration,
  /IF v_target\.estado IS DISTINCT FROM 'activo' THEN[\s\S]*?Cuenta destino no activa/,
  'Atomic manual balance adjustment must reject inactive and archived target profiles',
);
assert.match(
  inactiveFinanceMigration,
  /SELECT saldo, estado[\s\S]*?IF v_estado IS DISTINCT FROM 'activo' THEN[\s\S]*?No se puede pagar a una cuenta no activa/,
  'Batch salary/bonus payouts must reject inactive and archived target profiles',
);
assert.match(
  rollbackTest,
  /STEP10_ARCHIVED_ADJUSTMENT_TEST[\s\S]*?STEP10_ARCHIVED_PAYOUT_TEST/,
  'Transactional live test must exercise both archived-account guards',
);
console.log('PASS — admin adjustment and batch payout deny archived/inactive accounts; rollback test covers both paths');

console.log('PASS: ' + sqlChecks.length + ' migration invariant groups');


const salaryMigration = readFileSync('supabase/migrations/20261104235424_admin_salary_individual_batch.sql', 'utf8');
const salaryBatchTest = readFileSync('supabase/tests/admin_payroll_batch_atomicity.sql', 'utf8');
for (const [label, pattern] of [
  ['creates an RLS-protected idempotency ledger', /CREATE TABLE public\.admin_pagos_salario_idempotencia[\s\S]*?ENABLE ROW LEVEL SECURITY[\s\S]*?REVOKE ALL PRIVILEGES/i],
  ['requires an active administrator', /v_admin\.es_admin IS DISTINCT FROM true OR v_admin\.estado IS DISTINCT FROM 'activo'/],
  ['validates individual amounts and work dates', /monto positivo con máximo dos decimales[\s\S]*?días trabajados deben ser fechas válidas/i],
  ['rejects duplicate recipient IDs', /v_user_id\s*=\s*ANY\(v_ids\)/],
  ['locks recipient profiles before credit', /FROM public\.perfiles p[\s\S]*?WHERE p\.id=v_user_id[\s\S]*?FOR UPDATE/i],
  ['rejects inactive workers', /v_target\.estado IS DISTINCT FROM 'activo'/],
  ['enables trusted balance write only inside the RPC', /set_config\('cuevacoin\.trusted_balance_write','1',true\)/],
  ['checks the exact payload when replaying a batch', /ON CONFLICT\(idempotency_key\) DO NOTHING[\s\S]*?idempotency_key_payload_mismatch/i],
  ['writes ledger, notification and audit in one function', /INSERT INTO public\.transacciones[\s\S]*?INSERT INTO public\.notificaciones[\s\S]*?INSERT INTO public\.auditoria/i],
  ['limits RPC execution to authenticated and service_role', /REVOKE EXECUTE[\s\S]*?FROM PUBLIC,anon[\s\S]*?GRANT EXECUTE[\s\S]*?TO authenticated,service_role/i],
]) {
  assert.match(salaryMigration, pattern, 'Missing salary-batch invariant: ' + label);
  console.log('PASS — ' + label);
}
assert.match(salaryBatchTest, /BEGIN;[\s\S]*ROLLBACK;\s*$/i);
assert.match(salaryBatchTest, /replayed IS DISTINCT FROM true/);
assert.match(salaryBatchTest, /idempotency_key_payload_mismatch/);
assert.match(salaryBatchTest, /No se puede pagar a una cuenta no activa/);
console.log('PASS — salary batch transaction test verifies replay, payload mismatch, inactive-worker rejection and rollback');



const fortunaMigration = readFileSync(
  'supabase/migrations/20261122173537_fortuna_v1_private_ledger_and_owner_api.sql',
  'utf8',
);
assert.match(fortunaMigration, /BEGIN;[\s\S]*COMMIT;\s*$/i,
  'FORTUNA migration must be atomic');
assert.match(fortunaMigration,
  /CREATE OR REPLACE FUNCTION fortuna_private\.fortuna_list_obligations\([\s\S]*?p_contact_id uuid,[\s\S]*?p_currency_code text DEFAULT NULL,[\s\S]*?p_direction text DEFAULT NULL/i,
  'FORTUNA obligation detail must define optional currency and direction filters');
assert.match(fortunaMigration,
  /CREATE OR REPLACE FUNCTION api\.list_obligations\([\s\S]*?p_contact_id uuid,[\s\S]*?p_currency_code text DEFAULT NULL,[\s\S]*?p_direction text DEFAULT NULL[\s\S]*?SECURITY INVOKER/i,
  'API list_obligations must be an invoker wrapper');
assert.match(fortunaMigration,
  /REVOKE ALL ON FUNCTION api\.list_obligations\(uuid, text, text\) FROM PUBLIC, anon, authenticated[\s\S]*?GRANT EXECUTE ON FUNCTION api\.list_obligations\(uuid, text, text\) TO authenticated/i,
  'only authenticated may execute the exact obligation query wrapper');
assert.match(fortunaMigration,
  /REVOKE ALL ON ALL TABLES IN SCHEMA fortuna_private FROM PUBLIC, anon, authenticated/i,
  'private ledger tables must deny direct client privileges');
assert.doesNotMatch(fortunaMigration, /CREATE OR REPLACE FUNCTION auth\.uid\(/i,
  'production migration must not replace Supabase Auth auth.uid');
console.log('PASS — FORTUNA production migration static security contract');

// Recovered migration ledger: validate filenames and byte-exact SQL provenance.
const ledgerManifest = JSON.parse(readFileSync('docs/evidence/revision-6/SUPABASE_MIGRATION_LEDGER_SHA256.json', 'utf8'));
const migrationFiles = readdirSync('supabase/migrations').filter(name => name.length > 18 && [...name.slice(0, 14)].every(ch => ch >= '0' && ch <= '9') && name[14] === '_' && name.endsWith('.sql')).sort();
assert.equal(ledgerManifest.baseline_ledger_count, 65, 'Recovered LIVE baseline must remain 65 versions');
assert.equal(ledgerManifest.recovered.length, 58, 'Exactly 58 historical sources must retain provenance hashes');
assert.equal((ledgerManifest.forward_migrations || []).length, 4, 'Expected the four reviewed forward migrations documented in the recovery ledger');
const fortunaForward = (ledgerManifest.forward_migrations || []).find(entry =>
  entry.file === '20261122173537_fortuna_v1_private_ledger_and_owner_api.sql',
);
assert.ok(fortunaForward, 'FORTUNA migration must be present in the forward migration ledger');
assert.equal(fortunaForward.applied_to_live, true, 'FORTUNA migration must be marked as applied to LIVE');
assert.equal(fortunaForward.live_version, '20261122173537', 'FORTUNA migration filename must match the LIVE migration version');
assert.equal(fortunaForward.execution_status, 'applied', 'FORTUNA migration must be marked applied');
assert.equal(
  (ledgerManifest.forward_migrations || []).filter(entry => entry.applied_to_live === false && entry.execution_status === 'pending_review_not_applied').length,
  0,
  'No forward migration should be marked pending after FORTUNA was applied',
);

const fkIndexForward = (ledgerManifest.forward_migrations || []).find(entry =>
  entry.file === '20261122192417_fortuna_private_fk_covering_indexes.sql',
);
assert.ok(fkIndexForward, 'FORTUNA FK index migration must be tracked as a forward migration');
assert.equal(fkIndexForward.applied_to_live, true, 'FORTUNA FK indexes must be recorded as applied to LIVE');
assert.equal(fkIndexForward.live_version, '20261122210505', 'FORTUNA FK index migration must use the exact Supabase LIVE registry version');
assert.equal(fkIndexForward.execution_status, 'applied_live_index_catalog_verified');
assert.equal(fkIndexForward.repository_blob_sha, '6d1bbf218600e2c19544c5ae5069251613bfa9d2');
assert.equal(fkIndexForward.index_count, 14);
assert.equal(fkIndexForward.private_foreign_keys_checked, 21);
assert.equal(fkIndexForward.uncovered_private_foreign_keys_after, 0);
assert.equal(fkIndexForward.performance_advisor_unindexed_foreign_keys_before, 32);
assert.equal(fkIndexForward.performance_advisor_unindexed_foreign_keys_after, 17);
assert.equal(fkIndexForward.remaining_advisor_findings_schema, 'public');
assert.equal(fkIndexForward.public_index_count_before, 34);
assert.equal(fkIndexForward.public_index_count_after, 34);
assert.equal(fkIndexForward.financial_data_rows_written, 0);
assert.ok(
  ledgerManifest.expected_files.includes(fkIndexForward.file),
  'The applied FORTUNA index migration source must remain in the tracked SQL inventory',
);
assert.equal(
  (ledgerManifest.pending_forward_migrations || []).some(entry =>
    entry.file === '20261122192417_fortuna_private_fk_covering_indexes.sql'),
  false,
  'An applied FORTUNA index migration must not remain in the pending list',
);
const fkIndexSql = readFileSync('supabase/migrations/' + fkIndexForward.file, 'utf8');
assert.match(fkIndexSql, /BEGIN;[\s\S]*COMMIT;\s*$/i);
assert.equal(
  (fkIndexSql.match(/^\s*CREATE INDEX IF NOT EXISTS\s+/gim) || []).length,
  14,
  'The applied FORTUNA FK index migration source must retain exactly 14 additive indexes',
);
assert.doesNotMatch(
  fkIndexSql,
  /\bCREATE\s+TABLE\b|\bALTER\s+TABLE\b|\bDROP\s+TABLE\b|\bTRUNCATE\b|\bGRANT\b|\bREVOKE\b|\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/i,
  'The applied FORTUNA FK migration source must remain index-only',
);
console.log('PASS — FORTUNA FK index migration is reconciled to LIVE version 20261122210505 with 14 verified indexes and no pending duplicate');

const activityForward = (ledgerManifest.forward_migrations || []).find(entry =>
  entry.file === '20261123182957_fortuna_owner_activity_history.sql',
);
assert.ok(activityForward, 'FORTUNA owner activity history migration must be tracked as a forward migration');
assert.equal(activityForward.applied_to_live, true, 'FORTUNA activity history migration must be recorded as applied to LIVE');
assert.equal(activityForward.live_version, '20261123194707', 'FORTUNA activity history must match the exact LIVE migration registry version');
assert.equal(activityForward.execution_status, 'applied_live');
assert.ok(
  ledgerManifest.expected_files.includes(activityForward.file),
  'Applied FORTUNA activity history migration must remain in the tracked SQL inventory',
);
assert.equal(
  (ledgerManifest.pending_forward_migrations || []).some(entry => entry.file === activityForward.file),
  false,
  'Applied FORTUNA activity history migration must not remain pending',
);
const activitySql = readFileSync('supabase/migrations/' + activityForward.file, 'utf8');
assert.match(activitySql, /CREATE OR REPLACE FUNCTION fortuna_private\.fortuna_list_activity/);
assert.match(activitySql, /CREATE OR REPLACE FUNCTION api\.list_activity/);
assert.match(activitySql, /SECURITY INVOKER/);
assert.match(activitySql, /REVOKE ALL ON FUNCTION api\.list_activity[\s\S]*?FROM PUBLIC, anon, authenticated/);
assert.match(activitySql, /GRANT EXECUTE ON FUNCTION api\.list_activity[\s\S]*?TO authenticated/);
assert.match(activitySql, /BEGIN;[\s\S]*COMMIT;\s*$/i);
console.log('PASS — FORTUNA owner activity history migration reconciled to LIVE version 20261123194707; authenticated read-only wrapper tracked without replay');

const recipientForward = (ledgerManifest.forward_migrations || []).find(entry =>
  entry.file === '20261121124522_transfer_recipient_id_privacy_active_admin.sql',
);
assert.ok(recipientForward, 'Nov 21 recipient-privacy migration must use the exact LIVE version filename');
assert.equal(recipientForward.live_version, '20261121124522', 'Nov 21 migration must match the LIVE registry version');
assert.equal(recipientForward.applied_to_live, true, 'Nov 21 migration must remain recorded as applied to LIVE');
assert.equal(
  recipientForward.execution_status,
  'applied_live_executable_sql_matches_comments_only_difference',
  'Nov 21 migration provenance must distinguish comments-only source drift from pending execution',
);
assert.equal(recipientForward.hosted_statement_characters, 9174);
assert.equal(recipientForward.hosted_statement_md5, '2b07ab98ef1814b936d3b21252367bdc');
assert.ok(
  ledgerManifest.expected_files.includes('20261121124522_transfer_recipient_id_privacy_active_admin.sql'),
  'Expected migration files must contain the exact LIVE version filename',
);
assert.ok(
  !ledgerManifest.expected_files.includes('20261121110000_transfer_recipient_id_privacy_active_admin.sql'),
  'The stale pre-LIVE filename must not remain in the expected migration set',
);
const recipientMigration = readFileSync(
  'supabase/migrations/20261121124522_transfer_recipient_id_privacy_active_admin.sql',
  'utf8',
);
assert.match(recipientMigration, /CREATE OR REPLACE FUNCTION public\.resolver_destinatario_transferencia_v2/);
assert.match(recipientMigration, /This migration is already applied\. Never replay it/);
assert.doesNotMatch(recipientMigration, /Review and explicit authorization are required before production execution/i);
console.log('PASS — Nov 21 applied migration filename, hosted statement provenance, and no-replay invariant');
assert.deepEqual(
  migrationFiles,
  [...ledgerManifest.expected_files].sort(),
  'Tracked migration filenames must match the recovered LIVE baseline plus reviewed forward migrations',
);
for (const entry of ledgerManifest.recovered) {
  const source = readFileSync('supabase/migrations/' + entry.file, 'utf8');
  // Git for Windows may check out LF files as CRLF; normalize before provenance hashing.
  const normalizedSource = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const actual = createHash('sha256').update(normalizedSource, 'utf8').digest('hex');
  assert.equal(actual, entry.sha256, 'Recovered SQL must match the original Supabase ledger statement: ' + entry.file);
}
for (const forward of ledgerManifest.forward_migrations || []) {
  const source = readFileSync('supabase/migrations/' + forward.file, 'utf8');
  assert.ok(source.trim().length > 0, 'Forward migration source must not be empty: ' + forward.file);
}
console.log('PASS — all ' + ledgerManifest.baseline_ledger_count + ' LIVE baseline and forward filenames plus ' + (ledgerManifest.forward_migrations || []).length + ' applied forward migration record(s) match; all ' + ledgerManifest.recovered.length + ' recovered SQL files retain ledger SHA-256 provenance');
