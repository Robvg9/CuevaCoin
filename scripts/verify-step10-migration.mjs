import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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


const salaryMigration = readFileSync('supabase/migrations/20261104183000_admin_salary_individual_batch.sql', 'utf8');
const salaryBatchTest = readFileSync('supabase/tests/admin_payroll_batch_atomicity.sql', 'utf8');
for (const [label, pattern] of [
  ['creates an RLS-protected idempotency ledger', /CREATE TABLE public\.admin_pagos_salario_idempotencia[\s\S]*?ENABLE ROW LEVEL SECURITY[\s\S]*?REVOKE ALL PRIVILEGES/i],
  ['requires an active administrator', /v_admin\.es_admin IS DISTINCT FROM true OR v_admin\.estado IS DISTINCT FROM 'activo'/],
  ['validates individual amounts and work dates', /monto positivo con máximo dos decimales[\s\S]*?días trabajados deben ser fechas válidas/i],
  ['rejects duplicate recipient IDs', /v_user_id\\s*=\\s*ANY\\(v_ids\\)/],
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
