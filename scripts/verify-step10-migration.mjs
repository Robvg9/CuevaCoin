import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20261014161000_step10_p0_security_atomic_balance_adjustment.sql';
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
assert.match(rollbackTest, /BEGIN;[\\s\\S]*ROLLBACK;\\s*$/i);
assert.match(rollbackTest, /v_replay/);
assert.match(rollbackTest, /non-admin/i);
assert.match(rollbackTest, /STEP10_FORCE_ATOMIC_ROLLBACK_TEST/);
console.log('PASS — transactional test covers replay, authorization, and rollback without persistence');

console.log('PASS: ' + sqlChecks.length + ' migration invariant groups');
