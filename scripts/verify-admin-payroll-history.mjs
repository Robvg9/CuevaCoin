import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const read=p=>readFileSync(p,'utf8');
const index=read('index.html'),sw=read('service-worker.js'),audit=read('js/admin/finance/auditoria.js'),history=read('js/admin/finance/historial-general.js'),recipients=read('js/admin/finance/destinatarios.js'),payments=read('js/admin/finance/pagos.js'),navigation=read('js/ui/navigation.js'),admin=read('js/finance/orchestration/show-admin-panel.js'),user=read('js/finance/orchestration/show-user-dashboard.js'),migration=read('supabase/migrations/20261104183000_admin_salary_individual_batch.sql'),sqlTest=read('supabase/tests/admin_payroll_batch_atomicity.sql');
assert.match(audit,/\.range\(auditOffset,auditOffset\+AUDIT_PAGE_SIZE-1\)/);assert.match(audit,/const AUDIT_PAGE_SIZE=25/);assert.match(index,/id="audit-ver-mas-btn"/);assert.match(index,/loadAdminAuditoria\(\{append:true\}\)/);assert.match(audit,/limit\(300\)/);console.log('PASS — bounded audit pages');
assert.match(history,/\.range\(historyOffset,historyOffset\+HISTORY_PAGE_SIZE-1\)/);assert.match(history,/const HISTORY_PAGE_SIZE=20/);assert.match(history,/motivo\.not\.ilike\.Bono/);assert.match(index,/id="admin-general-history-more"/);assert.match(index,/value="salarios"/);assert.match(navigation,/section === 'historial-general'/);assert.match(admin,/historial-general-link/);assert.match(user,/historial-general-link/);assert.doesNotMatch(history,/\.(insert|update|upsert|delete)\s*\(/);console.log('PASS — admin-only global read-only ledger');
assert.match(index,/id="salario-trabajadoras-lista"/);assert.match(index,/id="salario-buscar-trabajadora"/);assert.match(index,/id="salario-submit-btn"/);assert.doesNotMatch(index.slice(index.indexOf('<!-- Pago de salario:'),index.indexOf('<!-- Dar Bono Modal -->')),/salario-monto|salario-motivo|abrirSelectorDestinatarios\('salario'\)/);assert.match(recipients,/date\.type = 'date'/);assert.match(recipients,/salario-trabajadora-monto/);assert.match(payments,/admin_pagar_salarios_individuales/);assert.match(payments,/cuevacoin_salary_batch_pending/);assert.match(payments,/Reintentar el mismo pago/);console.log('PASS — per-worker salary amount and day selection');
assert.match(migration,/ENABLE ROW LEVEL SECURITY/);assert.match(migration,/REVOKE ALL PRIVILEGES/);assert.match(migration,/v_admin\.estado IS DISTINCT FROM 'activo'/);assert.match(migration,/ON CONFLICT\(idempotency_key\) DO NOTHING/);assert.match(migration,/idempotency_key_payload_mismatch/);assert.match(migration,/FOR UPDATE/);assert.match(migration,/set_config\('cuevacoin\.trusted_balance_write','1',true\)/);assert.match(migration,/INSERT INTO public\.transacciones[\s\S]*?INSERT INTO public\.notificaciones[\s\S]*?INSERT INTO public\.auditoria/);assert.match(sqlTest,/replayed IS DISTINCT FROM true/);assert.match(sqlTest,/No se puede pagar a una cuenta no activa/);assert.match(sqlTest,/ROLLBACK;\s*$/);console.log('PASS — atomic and idempotent SQL invariants');
assert.match(index,/VERSION_FALLBACK = 'V\.151'/);assert.match(sw,/cuevacoin-shell-v151/);assert.match(index,/historial-general\.js\?v=151/);console.log('PASS — versioned PWA assets');

for (const path of [
 'js/admin/finance/auditoria.js',
 'js/admin/finance/historial-general.js',
 'js/admin/finance/destinatarios.js',
 'js/admin/finance/pagos.js',
 'js/ui/navigation.js',
 'js/finance/orchestration/show-admin-panel.js',
 'js/finance/orchestration/show-user-dashboard.js',
]) {
 const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: read(path), encoding: 'utf8' });
 assert.equal(syntax.status, 0, 'Invalid JavaScript syntax in ' + path + ': ' + (syntax.stderr || ''));
}
console.log('PASS — changed JavaScript modules parse as ES modules');
