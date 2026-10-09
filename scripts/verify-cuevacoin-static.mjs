import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const checks = [];

function check(name, fn) {
    fn();
    checks.push(name);
}

function walk(directory) {
    const items = [];
    for (const entry of readdirSync(join(root, directory))) {
        const path = join(root, directory, entry);
        const rel = relative(root, path);
        if (statSync(path).isDirectory()) items.push(...walk(rel));
        else if (path.endsWith('.js')) items.push(rel);
    }
    return items;
}

const index = read('index.html');
const userCards = read('js/admin/finance/usuarios.js');
const adminHistory = read('js/admin/finance/historial-trabajadora.js');
const userHistory = read('js/finance/history/historial.js');
const syncQueue = read('js/finance/queue/offline-queue.js');
const legacy = read('js/legacy-app.js');
const payments = read('js/admin/finance/pagos.js');
const app = read('js/core/app.js');
const sw = read('service-worker.js');
const atomicAdjustmentSql = read('docs/evidence/revision-5/ADMIN_SALDO_ATOMICO_PROPUESTO_NO_EJECUTADO.sql');

for (const path of [...walk('js'), 'js/legacy-app.js']) {
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
        input: read(path),
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, `Syntax error in ${path}: ${result.stderr || result.stdout}`);
}
checks.push('JavaScript syntax (all js/**/*.js)');

for (const match of index.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1];
    const body = match[2];
    if (/\bsrc\s*=/.test(attributes) || /application\/(json|ld\+json)/i.test(attributes)) continue;
    const isModule = /\btype\s*=\s*["']module["']/i.test(attributes);
    const args = isModule ? ['--check', '--input-type=module'] : ['--check'];
    const result = spawnSync(process.execPath, args, { input: body, encoding: 'utf8' });
    assert.equal(result.status, 0, `Syntax error in inline script: ${result.stderr || result.stdout}`);
}
checks.push('Inline JavaScript syntax in index.html');

check('Admin worker card exposes read-only history action', () => {
    assert.match(userCards, /abrirHistorialTrabajadoraAdmin/);
    assert.match(index, /id="admin-worker-history-modal"/);
    assert.match(index, /src="js\/admin\/finance\/historial-trabajadora\.js"/);
});

check('Admin history reads ledger per worker and does not write financial data', () => {
    assert.match(adminHistory, /\.from\('transacciones'\)/);
    assert.match(adminHistory, /\.eq\('usuario_id', usuarioId\)/);
    assert.match(adminHistory, /if \(!admin\?\.esAdmin\)/);
    assert.doesNotMatch(adminHistory, /\.(insert|update|upsert|delete)\s*\(/);
});

check('Worker history classifies transactions locally and distinguishes admin discounts', () => {
    assert.doesNotMatch(userHistory, /window\.categoriaTransaccion\(t\)/);
    assert.match(userHistory, /return cantidad < 0 \? 'descuento' : 'ajuste'/);
    assert.match(index, /option value="descuento">Descuentos del admin/);
});

check('Reconnect path re-reads profile from server and refreshes the current section', () => {
    assert.match(legacy, /revalidarDatosTrasConexion/);
    assert.match(legacy, /window\.obtenerMiPerfilApp\(\)/);
    assert.match(legacy, /addEventListener\('focus'/);
    assert.match(legacy, /addEventListener\('visibilitychange'/);
});

check('Stale offline banner only clears after backend connectivity confirmation', () => {
    assert.match(syncQueue, /window\.hayConexionRealAhora\(\)/);
    assert.match(syncQueue, /window\.ocultarConexionStrip\(\)/);
});

check('Partial salary/bonus failures are not overwritten by generic success toast', () => {
    assert.match(payments, /Pago parcial:/);
    assert.doesNotMatch(payments, /pagado a \$\{data\.length\}/);
});

check('Client removes duplicate/invalid recipients before issuing a batch payment', () => {
    assert.match(payments, /const idsVistos = new Set\(\)/);
    assert.match(payments, /idsVistos\.has\(id\)/);
    assert.match(payments, /p_destinatarios: seleccion\.map\(u => u\.id\)/);
});

check('Admin balance adjustment calls only the atomic idempotent RPC from the client', () => {
    const start = legacy.indexOf("document.getElementById('ajustar-saldo-form').addEventListener('submit'");
    const end = legacy.indexOf("        // F7 (fix): antes esta función", start);
    assert.ok(start >= 0 && end > start, 'Balance adjustment handler must be located for inspection');
    const handler = legacy.slice(start, end);
    assert.ok(handler.includes("rpc('admin_ajustar_saldo_atomico'"), 'Client must call the atomic RPC');
    assert.ok(handler.includes('cuevacoin_admin_ajuste_saldo_pendiente'), 'Client must persist unresolved idempotency state');
    assert.ok(handler.includes('p_idempotency_key: pending.key'), 'Client must send the same stable key to the backend');
    assert.ok(!handler.includes(".from('perfiles')"), 'Client must not mutate balance directly');
    assert.ok(!handler.includes(".from('transacciones')"), 'Client must not insert the ledger separately');
});

check('Unexecuted atomic adjustment SQL proposal encodes core safety gates', () => {
    assert.ok(atomicAdjustmentSql.includes('auth.uid()'), 'Server function must identify the caller');
    assert.ok(atomicAdjustmentSql.includes('v_admin.es_admin IS DISTINCT FROM true'), 'Server must authorize admin');
    assert.ok(atomicAdjustmentSql.includes('FOR UPDATE'), 'Server must lock the target profile');
    assert.ok(atomicAdjustmentSql.includes('ON CONFLICT (idempotency_key) DO NOTHING'), 'Server must serialize retries');
    assert.ok(atomicAdjustmentSql.includes('INSERT INTO public.transacciones'), 'Ledger insert must be in the function');
    assert.ok(atomicAdjustmentSql.includes('INSERT INTO public.notificaciones'), 'Persisted notification must be in the function');
    assert.ok(atomicAdjustmentSql.includes('INSERT INTO public.auditoria'), 'Audit write must be in the function');
    assert.ok(atomicAdjustmentSql.includes('ALTER TABLE public.admin_ajustes_saldo_idempotencia ENABLE ROW LEVEL SECURITY'), 'Idempotency table must enable RLS');
    assert.ok(atomicAdjustmentSql.includes('FROM PUBLIC, anon'), 'Public and anon must not execute the function');
    assert.ok(atomicAdjustmentSql.includes('TO authenticated'), 'Authenticated role gets the RPC grant');
    assert.ok(atomicAdjustmentSql.includes('NO EJECUTADA'), 'Proposal must not be mistaken for an applied migration');
});

check('PWA release version is consistent across Service Worker, modular app, and legacy inline fallback', () => {
    assert.ok(sw.includes("cuevacoin-shell-v137"), 'Service Worker must publish release v137');
    assert.ok(app.includes("VERSION_FALLBACK = 'V.137'"), 'Modular app fallback must be v137');
    assert.ok(index.includes("const VERSION_FALLBACK = 'V.137';"), 'Legacy inline fallback must be v137');
    assert.ok(!index.includes("const VERSION_FALLBACK = 'V.135';"), 'Legacy inline fallback must not advertise v135');
    assert.ok(!sw.includes("cuevacoin-shell-v136"), 'Service Worker must not keep the live v136 cache name');
});

check('QR and Chart.js URLs use the corrected matching CDN bundles in HTML and Service Worker', () => {
    const qr = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    const chart = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
    assert.ok(index.includes(qr), 'index.html must use the working jsQR bundle');
    assert.ok(index.includes(chart), 'index.html must use the working Chart.js bundle');
    assert.ok(sw.includes(qr), 'Service Worker must precache the same jsQR URL');
    assert.ok(sw.includes(chart), 'Service Worker must precache the same Chart.js URL');
    assert.doesNotMatch(index, /cdnjs\.cloudflare\.com\/ajax\/libs\/(?:jsQR|Chart\.js)/i);
    assert.doesNotMatch(sw, /cdnjs\.cloudflare\.com\/ajax\/libs\/(?:jsQR|Chart\.js)/i);
});

for (const asset of [
    { name: 'jsQR', url: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js' },
    { name: 'Chart.js', url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js' }
]) {
    let response = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            response = await fetch(asset.url, { signal: AbortSignal.timeout(12000), cache: 'no-store' });
            if (response.ok) break;
            lastError = new Error(`${asset.name} CDN returned HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
    }
    assert.ok(response?.ok, `${asset.name} CDN check failed: ${lastError?.message || 'no response'}`);
    assert.match(response.headers.get('content-type') || '', /javascript|ecmascript/i, `${asset.name} CDN must return JavaScript`);
    const source = await response.text();
    assert.ok(source.length > 10000, `${asset.name} CDN returned an unexpectedly short payload`);
    assert.doesNotMatch(source.slice(0, 500), /<html|404 Not Found/i, `${asset.name} CDN returned an error document`);
    checks.push(`${asset.name} CDN HTTP and JavaScript payload`);
}

console.log('PASS: ' + checks.length + ' verification groups');
for (const label of checks) console.log('PASS — ' + label);
