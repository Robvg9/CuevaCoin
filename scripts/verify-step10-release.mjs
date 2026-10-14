import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const read = (path) => readFileSync(path, 'utf8');
const index = read('index.html');
const legacy = read('js/legacy-app.js');
const sw = read('service-worker.js');
const app = read('js/core/app.js');
const migration = read('supabase/migrations/20261014161000_step10_p0_security_atomic_balance_adjustment.sql');

const start = legacy.indexOf("document.getElementById('ajustar-saldo-form').addEventListener('submit'");
const end = legacy.indexOf('// F7 (fix): antes esta función', start);
assert.ok(start >= 0 && end > start, 'Balance adjustment submit handler must be present');
const handler = legacy.slice(start, end);
assert.match(handler, /rpc\('admin_ajustar_saldo_atomico'/, 'Manual adjustments must use the atomic RPC');
assert.match(handler, /p_idempotency_key: pending\.key/, 'Retries must reuse the persisted idempotency key');
assert.match(handler, /cuevacoin_admin_ajuste_saldo_pendiente/, 'Uncertain replies must preserve idempotency state');
assert.doesNotMatch(handler, /\.from\('perfiles'\)\s*\.update\s*\(/, 'Client must not update saldo directly');
assert.doesNotMatch(handler, /\.from\('transacciones'\)\s*\.insert\s*\(/, 'Client must not insert ledger separately');
assert.doesNotMatch(handler, /\.from\('notificaciones'\)\s*\.insert\s*\(/, 'Client must not create financial notification separately');
assert.doesNotMatch(handler, /\.from\('auditoria'\)\s*\.insert\s*\(/, 'Client must not create financial audit separately');
console.log('PASS — balance adjustment uses server-side atomic idempotent RPC only');

assert.match(sw, /cuevacoin-shell-v137/);
assert.doesNotMatch(sw, /cuevacoin-shell-v136/);
assert.match(app, /VERSION_FALLBACK = 'V\.137'/);
assert.match(index, /const VERSION_FALLBACK = 'V\.137'/);
console.log('PASS — PWA release version aligned to V.137');

const qr='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
const chart='https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
for (const [name,source] of [['index.html',index],['service-worker.js',sw]]) {
  assert.ok(source.includes(qr), name+' must use correct jsQR bundle');
  assert.ok(source.includes(chart), name+' must use correct Chart.js bundle');
  assert.doesNotMatch(source,/cdnjs\.cloudflare\.com\/ajax\/libs\/(?:jsQR|Chart\.js)/i);
}
console.log('PASS — broken jsQR/Chart.js CDN references removed from PWA and service worker');

const migrationPath='supabase/migrations/20261014161000_step10_p0_security_atomic_balance_adjustment.sql';
assert.ok(migration.includes('admin_ajustar_saldo_atomico'), 'Step 10 RPC migration must exist');
assert.ok(migration.includes('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon'));
console.log('PASS — Step 10 security migration present');

// Parse and syntax-check shipped local JavaScript, matching the application's module/script modes.
function walk(dir) {
  const out=[];
  for (const name of readdirSync(dir)) {
    const path=join(dir,name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith('.js')) out.push(path);
  }
  return out;
}
for (const path of walk('js')) {
  const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:read(path),encoding:'utf8'});
  assert.equal(result.status,0,'JS syntax failed for '+path+': '+(result.stderr||result.stdout));
}
for (const match of index.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const attrs=match[1], body=match[2];
  if (/\bsrc\s*=/.test(attrs) || /application\/(?:json|ld\+json)/i.test(attrs)) continue;
  const isModule=/\btype\s*=\s*["']module["']/i.test(attrs);
  const args=isModule?['--check','--input-type=module']:['--check'];
  const result=spawnSync(process.execPath,args,{input:body,encoding:'utf8'});
  assert.equal(result.status,0,'Inline JavaScript syntax failed: '+(result.stderr||result.stdout));
}
console.log('PASS — JavaScript module and inline script syntax');
console.log('PASS: Step 10 frontend pre-release checks');
