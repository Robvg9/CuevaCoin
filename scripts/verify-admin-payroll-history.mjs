import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const read=p=>readFileSync(p,'utf8');
const index=read('index.html'),sw=read('service-worker.js'),audit=read('js/admin/finance/auditoria.js'),history=read('js/admin/finance/historial-general.js'),localDateRange=read('js/utils/local-date-range.js'),recipients=read('js/admin/finance/destinatarios.js'),payments=read('js/admin/finance/pagos.js'),navigation=read('js/ui/navigation.js'),admin=read('js/finance/orchestration/show-admin-panel.js'),user=read('js/finance/orchestration/show-user-dashboard.js'),migration=read('supabase/migrations/20261104183000_admin_salary_individual_batch.sql'),sqlTest=read('supabase/tests/admin_payroll_batch_atomicity.sql');
assert.match(audit,/\.range\(auditOffset,\s*auditOffset\s*\+\s*AUDIT_PAGE_SIZE\s*-\s*1\)/);assert.match(audit,/const AUDIT_PAGE_SIZE\s*=\s*25/);assert.match(index,/id="audit-ver-mas-btn"/);assert.match(index,/loadAdminAuditoria\(\{append:true\}\)/);assert.match(audit,/limit\(300\)/);assert.match(audit,/getLocalDateRange\(filters\.desde,\s*filters\.hasta\)/);assert.match(audit,/\.order\('id',\s*\{\s*ascending:\s*false\s*\}\)/);console.log('PASS — bounded audit pages with local date filters and deterministic ordering');
assert.match(history,/\.range\(historyOffset,\s*historyOffset\s*\+\s*HISTORY_PAGE_SIZE\s*-\s*1\)/);assert.match(history,/const HISTORY_PAGE_SIZE\s*=\s*20/);assert.match(history,/motivo\.not\.ilike\.Bono/);assert.match(history,/getLocalDateRange\(from,\s*to\)/);assert.match(history,/\.order\('id',\s*\{\s*ascending:\s*false\s*\}\)/);assert.doesNotMatch(history,/T00:00:00\.000Z/);assert.doesNotMatch(audit,/T00:00:00\.000Z/);assert.match(index,/id="admin-general-history-more"/);assert.match(index,/value="salarios"/);assert.match(navigation,/section === 'historial-general'/);assert.match(admin,/historial-general-link/);assert.match(user,/historial-general-link/);assert.doesNotMatch(history,/\.(insert|update|upsert|delete)\s*\(/);console.log('PASS — admin-only global read-only ledger');
assert.match(index,/id="salario-trabajadoras-lista"/);assert.match(index,/id="salario-buscar-trabajadora"/);assert.match(index,/id="salario-submit-btn"/);assert.doesNotMatch(index.slice(index.indexOf('<!-- Pago de salario:'),index.indexOf('<!-- Dar Bono Modal -->')),/salario-monto|salario-motivo|abrirSelectorDestinatarios\('salario'\)/);assert.match(recipients,/date\.type = 'date'/);assert.match(recipients,/salario-trabajadora-monto/);assert.match(payments,/admin_pagar_salarios_individuales/);assert.match(payments,/cuevacoin_salary_batch_pending/);assert.match(payments,/Reintentar el mismo pago/);console.log('PASS — per-worker salary amount and day selection');
assert.match(migration,/ENABLE ROW LEVEL SECURITY/);assert.match(migration,/REVOKE ALL PRIVILEGES/);assert.match(migration,/v_admin\.estado IS DISTINCT FROM 'activo'/);assert.match(migration,/ON CONFLICT\(idempotency_key\) DO NOTHING/);assert.match(migration,/idempotency_key_payload_mismatch/);assert.match(migration,/FOR UPDATE/);assert.match(migration,/set_config\('cuevacoin\.trusted_balance_write','1',true\)/);assert.match(migration,/INSERT INTO public\.transacciones[\s\S]*?INSERT INTO public\.notificaciones[\s\S]*?INSERT INTO public\.auditoria/);assert.match(sqlTest,/replayed IS DISTINCT FROM true/);assert.match(sqlTest,/No se puede pagar a una cuenta no activa/);assert.match(sqlTest,/ROLLBACK;\s*$/);console.log('PASS — atomic and idempotent SQL invariants');
assert.match(localDateRange,/endExclusive\.setDate\(endExclusive\.getDate\(\) \+ 1\)/);
const testLocalDate=(timezone,day,start,endExclusive)=>{
 const source="import { getLocalDateRange } from './js/utils/local-date-range.js'; process.stdout.write(JSON.stringify(getLocalDateRange("+JSON.stringify(day)+","+JSON.stringify(day)+")));";
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,TZ:timezone}});
 assert.equal(result.status,0,'Local date calculation failed for '+timezone+': '+result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),{start,endExclusive});
};
testLocalDate('America/Puerto_Rico','2026-11-04','2026-11-04T04:00:00.000Z','2026-11-05T04:00:00.000Z');
testLocalDate('America/New_York','2026-03-08','2026-03-08T05:00:00.000Z','2026-03-09T04:00:00.000Z');
testLocalDate('America/New_York','2026-11-01','2026-11-01T04:00:00.000Z','2026-11-02T05:00:00.000Z');
const invalidDate=spawnSync(process.execPath,['--input-type=module','-e',"import { getLocalDateRange } from './js/utils/local-date-range.js'; getLocalDateRange('2026-02-30','');"],{encoding:'utf8'});
assert.notEqual(invalidDate.status,0,'Invalid calendar dates must be rejected');
console.log('PASS — local date boundaries cover Puerto Rico and 23/25-hour DST days');
assert.match(index,/VERSION_FALLBACK = 'V\.152'/);assert.match(sw,/cuevacoin-shell-v152/);assert.match(index,/historial-general\.js\\?v=152/);assert.match(index,/auditoria\.js\\?v=152/);console.log('PASS — versioned V152 PWA assets');

for (const path of [
 'js/utils/local-date-range.js',
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
