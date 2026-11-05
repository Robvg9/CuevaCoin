import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const read = p => readFileSync(p, 'utf8');
const index = read('index.html');
const sw = read('service-worker.js');
const history = read('js/admin/finance/historial-general.js');
const recipients = read('js/admin/finance/destinatarios.js');
const payments = read('js/admin/finance/pagos.js');
const navigation = read('js/ui/navigation.js');
const app = read('js/core/app.js');
const localDateRange = read('js/utils/local-date-range.js');
const migration = read('supabase/migrations/20261104183000_admin_salary_individual_batch.sql');
const sqlTest = read('supabase/tests/admin_payroll_batch_atomicity.sql');

assert.match(history, /from\('transacciones'\)/);
assert.match(history, /from\('auditoria'\)/);
assert.match(history, /takeMergedPage/);
assert.match(history, /compareRecent/);
assert.match(history, /applyKeysetCursor/);
assert.match(history, /creado_en\.lt\./);
assert.match(history, /id\.lt\./);
assert.match(history, /limit\(HISTORY_PAGE_SIZE\)/);
assert.match(history, /admin-general-history-audit/);
assert.match(history, /appendBoldDetail\(details, 'Trabajadora: '/);
assert.match(history, /appendBoldDetail\(details, 'Motivo: '/);
assert.match(history, /appendBoldDetail\(details, 'Usuario: '/);
assert.match(history, /textContent = value/);
assert.doesNotMatch(history, /\.(insert|update|upsert|delete)\s*\(/);
console.log('PASS — single chronological feed merges financial transactions and complete audit events; stable keyset pagination; bold safe text.');

assert.match(index, /Todos los movimientos financieros y eventos de auditoría/);
assert.match(index, /Todos los movimientos y eventos/);
assert.match(index, /Buscar en historial/);
assert.match(index, /id="admin-general-history-list"/);
assert.match(navigation, /section === 'auditoria'\) section = 'historial-general'/);
console.log('PASS — both admin history/audit navigation paths resolve to the unified history.');

assert.match(index, /id="salario-trabajadoras-lista"/);
assert.match(index, /id="salario-selector-buscar"/);
assert.match(index, /id="salario-selector-panel"/);
assert.match(index, /id="salario-selector-lista"/);
assert.match(index, /Seleccionar trabajadoras/);
assert.match(index, /cuevacoin-v154-unified-admin-history-layout/);
assert.match(recipients, /function salaryMotive\(days\)/);
assert.match(recipients, /Motivo/);
assert.match(recipients, /from\.type = 'date'/);
assert.match(recipients, /to\.type = 'date'/);
assert.match(recipients, /buildInclusiveDays/);
assert.match(recipients, /count > 31/);
assert.match(recipients, /salario-trabajadora-monto/);
assert.match(recipients, /salario-trabajadora-motivo/);
assert.match(payments, /admin_pagar_salarios_individuales/);
assert.match(payments, /cuevacoin_salary_batch_pending/);
assert.match(payments, /Reintentar el mismo pago/);
assert.match(payments, /newIdempotencyKey/);
assert.match(index, /cuevacoin-v154-unified-admin-history/);
console.log('PASS — vertical per-worker salary form, individual amount and calendar-generated reason; atomic/idempotent RPC path retained.');

const salaryRangeSource = [
  "import assert from 'node:assert/strict';",
  "import { buildInclusiveDays } from './js/admin/finance/destinatarios.js';",
  "assert.deepEqual(buildInclusiveDays('2026-10-11','2026-10-13'), ['2026-10-11','2026-10-12','2026-10-13']);",
  "assert.deepEqual(buildInclusiveDays('2026-02-28','2026-03-01'), ['2026-02-28','2026-03-01']);",
  "assert.throws(() => buildInclusiveDays('2026-10-14','2026-10-13'), /Hasta/);",
  "assert.throws(() => buildInclusiveDays('2026-02-30','2026-03-01'), /válidas/);",
  "assert.throws(() => buildInclusiveDays('2026-10-01','2026-11-01'), /31 días/);",
  "console.log('PASS — inclusive payroll calendar dates, real-date validation and 31-day cap');"
].join('\n');
const rangeTest = spawnSync(process.execPath, ['--input-type=module', '-e', salaryRangeSource], { encoding: 'utf8' });
assert.equal(rangeTest.status, 0, 'Salary date-range behavior failed: ' + (rangeTest.stderr || rangeTest.stdout));
console.log(rangeTest.stdout.trim());

assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL PRIVILEGES/);
assert.match(migration, /v_admin\.estado IS DISTINCT FROM 'activo'/);
assert.match(migration, /ON CONFLICT\(idempotency_key\) DO NOTHING/);
assert.match(migration, /idempotency_key_payload_mismatch/);
assert.match(migration, /FOR UPDATE/);
assert.match(migration, /set_config\('cuevacoin\.trusted_balance_write','1',true\)/);
assert.match(migration, /INSERT INTO public\.transacciones[\s\S]*?INSERT INTO public\.notificaciones[\s\S]*?INSERT INTO public\.auditoria/);
assert.match(sqlTest, /replayed IS DISTINCT FROM true/);
assert.match(sqlTest, /No se puede pagar a una cuenta no activa/);
assert.match(sqlTest, /ROLLBACK;\s*$/);
console.log('PASS — existing atomic/idempotent salary SQL invariants preserved.');

assert.match(localDateRange, /endExclusive\.setDate\(endExclusive\.getDate\(\) \+ 1\)/);
const testLocalDate = (timezone, day, start, endExclusive) => {
  const source = "import { getLocalDateRange } from './js/utils/local-date-range.js'; process.stdout.write(JSON.stringify(getLocalDateRange(" + JSON.stringify(day) + "," + JSON.stringify(day) + ")));";
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', env: { ...process.env, TZ: timezone } });
  assert.equal(result.status, 0, 'Local date calculation failed for ' + timezone + ': ' + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { start, endExclusive });
};
testLocalDate('America/Puerto_Rico', '2026-11-04', '2026-11-04T04:00:00.000Z', '2026-11-05T04:00:00.000Z');
testLocalDate('America/New_York', '2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z');
testLocalDate('America/New_York', '2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z');
const invalidDate = spawnSync(process.execPath, ['--input-type=module', '-e', "import { getLocalDateRange } from './js/utils/local-date-range.js'; getLocalDateRange('2026-02-30','');"], { encoding: 'utf8' });
assert.notEqual(invalidDate.status, 0, 'Invalid calendar dates must be rejected');
console.log('PASS — local date boundaries cover Puerto Rico and 23/25-hour DST days.');

assert.match(app, /VERSION_FALLBACK = 'V\.154'/);
assert.match(sw, /cuevacoin-shell-v154/);
assert.match(index, /destinatarios\.js\?v=154/);
assert.match(index, /historial-general\.js\?v=154/);
assert.match(index, /cuevacoin-v154-unified-admin-history/);
for (const path of [
  'js/utils/local-date-range.js',
  'js/admin/finance/historial-general.js',
  'js/admin/finance/destinatarios.js',
  'js/admin/finance/pagos.js',
  'js/ui/navigation.js',
  'js/core/app.js'
]) {
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: read(path), encoding: 'utf8' });
  assert.equal(syntax.status, 0, 'Invalid JavaScript syntax in ' + path + ': ' + (syntax.stderr || ''));
}
console.log('PASS — V154 PWA references and changed JavaScript syntax.');
