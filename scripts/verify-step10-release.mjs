import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const read = (path) => readFileSync(path, 'utf8');
const index = read('index.html');
const utils = read('js/core/utils.js');
const loginHardening = read('js/auth/login-hardening.js');
const legacy = read('js/legacy-app.js');
const sw = read('service-worker.js');
const manifest = JSON.parse(read('manifest.json'));
const icon192 = readFileSync('icon-192.png');
const app = read('js/core/app.js');
const history = read('js/finance/history/historial.js');
const userCards = read('js/admin/finance/usuarios.js');
const workerReader = read('js/admin/trabajadoras.js');
const userState = read('js/admin/usuarios-estado.js');
const sessionRestore = read('js/finance/orchestration/procesar-sesion.js');
const adminHistory = read('js/admin/finance/historial-trabajadora.js');
const payments = read('js/admin/finance/pagos.js');
const syncQueue = read('js/finance/queue/offline-queue.js');
const migration = read('supabase/migrations/20261014161845_step10_p0_security_atomic_balance_adjustment.sql');
const guardMigration = read('supabase/migrations/20261014162706_step10_require_trusted_balance_write.sql');
const rollbackTest = read('supabase/tests/step10_atomic_adjustment_rollback.sql');
const frontendWorkflow = read('.github/workflows/step10-frontend.yml');
const sqlSafetyWorkflow = read('.github/workflows/step10-sql-safety.yml');
const workflowPushSection = (source) => {
  const start = source.indexOf('  push:');
  const end = source.indexOf('\npermissions:', start);
  assert.ok(start >= 0 && end > start, 'Workflow must define a push trigger');
  return source.slice(start, end);
};
const frontendPush = workflowPushSection(frontendWorkflow);
const sqlSafetyPush = workflowPushSection(sqlSafetyWorkflow);
const frontendPullRequest = frontendWorkflow.slice(frontendWorkflow.indexOf('  pull_request:'), frontendWorkflow.indexOf('\n  push:'));
const sqlSafetyPullRequest = sqlSafetyWorkflow.slice(sqlSafetyWorkflow.indexOf('  pull_request:'), sqlSafetyWorkflow.indexOf('\n  push:'));
assert.ok(frontendPush.includes('      - "main"'), 'Step 10 frontend verification must run on main pushes');
assert.ok(sqlSafetyPush.includes('      - "main"'), 'Step 10 SQL safety verification must run on main pushes');
const frontendRequiredPaths = [
  'index.html',
  'js/legacy-app.js',
  'js/core/app.js',
  'js/core/utils.js',
  'js/auth/login-hardening.js',
  'js/auth/password-recovery.js',
  'supabase/functions/recuperar-contrasena/**',
  'supabase/functions/cuevacoin-login/**',
  'scripts/verify-password-recovery.mjs',
  'js/finance/history/historial.js',
  'js/finance/queue/offline-queue.js',
  'js/admin/finance/historial-trabajadora.js',
  'js/admin/finance/pagos.js',
  'js/admin/finance/usuarios.js',
  'js/admin/trabajadoras.js',
  'js/admin/usuarios-estado.js',
  'js/data/profiles.js',
  'js/finance/orchestration/procesar-sesion.js',
  'service-worker.js',
  'supabase/migrations/**',
  'supabase/tests/**',
  'scripts/verify-step10-release.mjs',
  '.github/workflows/step10-frontend.yml',
];
for (const path of frontendRequiredPaths) {
  assert.ok(frontendPush.includes('"' + path + '"'), 'Step 10 frontend push filter must include ' + path);
  assert.ok(frontendPullRequest.includes('"' + path + '"'), 'Step 10 frontend PR filter must include ' + path);
}
for (const path of [
  'supabase/migrations/**',
  'supabase/tests/**',
  'scripts/verify-step10-migration.mjs',
  '.github/workflows/step10-sql-safety.yml',
]) {
  assert.ok(sqlSafetyPush.includes('"' + path + '"'), 'Step 10 SQL safety push filter must include ' + path);
  assert.ok(sqlSafetyPullRequest.includes('"' + path + '"'), 'Step 10 SQL safety PR filter must include ' + path);
}
console.log('PASS — Step 10 frontend and SQL safety checks cover main releases and all governed dependencies');

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

assert.ok(history.includes("admin:perfiles!transacciones_admin_id_fkey(nombre, usuario)"),
  'Worker history must embed the administrator through the real perfiles FK');
assert.ok(history.includes("contraparte:perfiles!transacciones_contraparte_id_fkey(nombre, usuario)"),
  'Worker history must embed counterparties through the real perfiles FK');
assert.ok(!history.includes("admin:admin_id") && !history.includes("contraparte:contraparte_id"),
  'Foreign-key column names must not be used as relation names in PostgREST embeds');
assert.ok(history.includes("if (tipoFiltro !== '' && categoriaTransaccion(t) !== tipoFiltro)"),
  'The history type filter must use its locally scoped category classifier');
assert.ok(history.includes("const categoria = categoriaTransaccion(t);"),
  'History rendering must use the same locally scoped category classifier');
console.log('PASS — worker history embeds profiles through valid foreign-key relations and uses its scoped classifier');

assert.match(sw, /cuevacoin-shell-v148/);
assert.ok(manifest.icons.some(icon => icon.src === '/icon-192.png' && icon.sizes === '192x192'), 'PWA manifest must include a real 192px icon');
assert.equal(icon192.readUInt32BE(16), 192, 'PWA 192px icon width must be 192');
assert.equal(icon192.readUInt32BE(20), 192, 'PWA 192px icon height must be 192');
assert.ok(sw.includes("'/icon-192.png'"), 'Service worker must precache the 192px icon');
assert.doesNotMatch(sw, /cuevacoin-shell-v140/);
assert.match(app, /VERSION_FALLBACK = 'V\.148'/);
assert.match(index, /const VERSION_FALLBACK = 'V\.148'/);
assert.ok(index.includes('src="js/finance/history/historial.js?v=141"'), 'Worker history module must use a versioned URL to bypass stale edge/browser cache');
assert.ok(index.includes('src="js/admin/finance/historial-trabajadora.js?v=148"'), 'Admin worker-history module must use a versioned URL');
assert.ok(index.includes('id="admin-worker-history-modal"'), 'Admin worker-history modal must exist');
assert.ok(userCards.includes('abrirHistorialTrabajadoraAdmin'), 'Admin worker cards must expose the read-only history action');
assert.ok(adminHistory.includes("admin:perfiles!transacciones_admin_id_fkey(nombre, usuario)"), 'Admin history must use the real admin foreign-key relation');
assert.ok(adminHistory.includes("contraparte:perfiles!transacciones_contraparte_id_fkey(nombre, usuario)"), 'Admin history must use the real counterparty foreign-key relation');
assert.ok(adminHistory.includes(".eq('usuario_id', usuarioId)"), 'Admin history must stay scoped to the selected worker');
assert.doesNotMatch(adminHistory, /\.(insert|update|upsert|delete)\s*\(/, 'Admin history module must be read-only');
assert.match(legacy, /revalidarDatosTrasConexion/);
assert.match(legacy, /window\.obtenerMiPerfilApp\(\)/);
assert.match(legacy, /addEventListener\('focus'/);
assert.match(legacy, /addEventListener\('visibilitychange'/);
assert.match(syncQueue, /window\.hayConexionRealAhora\(\)/);
assert.match(syncQueue, /window\.ocultarConexionStrip\(\)/);
assert.match(payments, /const idsVistos = new Set\(\)/);
assert.match(payments, /Pago parcial:/);
assert.ok(!payments.includes('pagado a '), 'Partial payment warning must not be overwritten by a generic success toast');
assert.match(history, /return cantidad < 0 \? 'descuento' : 'ajuste'/);
assert.ok(index.includes('option value="descuento">Descuentos del admin</option>'), 'Worker history must offer the admin-discount filter');

assert.ok(utils.includes("return identificador.includes('@')"), 'Login conversion must pass through an explicitly supplied email address');
assert.ok(utils.includes('cuevacoin.local'), 'Login must preserve internal username-to-email mapping');
assert.ok(index.includes('placeholder="Usuario o correo electrónico"'), 'Login must communicate that email is accepted');
assert.ok(index.includes('onclick="iniciarSesionConGoogle()"'), 'Login must retain the explicit Google sign-in action');
assert.ok(index.includes('onclick="crearCuentaConGoogle()"'), 'Login must retain the Google account creation action');
assert.ok(loginHardening.includes('utiliza el botón de Google'), 'Invalid-password guidance must direct Google-created users to OAuth');
console.log('PASS — login accepts internal usernames and explicit emails and explains the Google OAuth path');

assert.match(workerReader, /incluirArchivadas = false/, 'Ordinary worker lists must exclude archived accounts by default');
assert.match(workerReader, /perfil\.estado !== 'archivado'/, 'Archived accounts must be absent from normal recipient/worker lists');
assert.match(userState, /export async function archivarUsuario/, 'Admin must have an explicit archive action');
assert.match(userState, /update\(\{ estado: 'archivado' \}\)/, 'Archive action must use the existing status field without hard deleting data');
assert.match(userState, /export async function restaurarUsuario/, 'Admin must be able to restore archived accounts');
assert.match(userState, /update\(\{ estado: 'inactivo' \}\)/, 'Restoring an account must not silently reactivate access');
assert.match(userState, /No se puede archivar una cuenta administradora/, 'Admin accounts must not be archivable from this flow');
assert.doesNotMatch(userState, /\.delete\(/, 'Archive flow must not hard-delete profile or historical data');
assert.match(userCards, /filterEstado === 'archivado'/, 'The user view must provide a dedicated archived filter');
assert.match(userCards, /archivarUsuario\(/, 'Non-archived user cards must expose Archive');
assert.match(userCards, /restaurarUsuario\(/, 'Archived user cards must expose Restore');
assert.match(loginHardening, /usuario\.estado === 'archivado'/, 'Password login must block archived accounts');
assert.match(sessionRestore, /usuario\.estado === 'archivado'/, 'Persisted/OAuth sessions must block archived accounts on reload/reconnect');
assert.ok(index.includes('option value="archivado">Archivados</option>'), 'The UI must expose the Archived filter');
console.log('PASS — archived accounts hidden from normal lists, reversible admin actions, and login/session guards');
console.log('PASS — PWA release aligned to V.147 and worker-history modules cache-busted');

const qr='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
const chart='https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
for (const [name,source] of [['index.html',index],['service-worker.js',sw]]) {
  assert.ok(source.includes(qr), name+' must use correct jsQR bundle');
  assert.ok(source.includes(chart), name+' must use correct Chart.js bundle');
  assert.doesNotMatch(source,/cdnjs\.cloudflare\.com\/ajax\/libs\/(?:jsQR|Chart\.js)/i);
}
console.log('PASS — broken jsQR/Chart.js CDN references removed from PWA and service worker');

const migrationPath='supabase/migrations/20261014161845_step10_p0_security_atomic_balance_adjustment.sql';
assert.ok(migration.includes('admin_ajustar_saldo_atomico'), 'Step 10 RPC migration must exist');
assert.ok(migration.includes('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon'));
assert.match(guardMigration, /saldo_update_requires_atomic_rpc/);
assert.match(guardMigration, /set_config\('cuevacoin\.trusted_balance_write', '1', true\)/);
assert.match(guardMigration, /CREATE OR REPLACE FUNCTION public\.admin_resolver_retiro\([\s\S]*?set_config\('cuevacoin\.trusted_balance_write'/);
assert.match(rollbackTest, /Direct client-style balance writes must fail/);
assert.match(rollbackTest, /saldo_update_requires_atomic_rpc/);
console.log('PASS — direct balance writes blocked; protected RPC paths retain trusted write context');
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
