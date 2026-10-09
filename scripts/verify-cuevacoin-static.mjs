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

check('PWA cache version and fallback agree', () => {
    assert.match(sw, /cuevacoin-shell-v137/);
    assert.match(app, /VERSION_FALLBACK = 'V\.137'/);
});

console.log('PASS: ' + checks.length + ' verification groups');
for (const label of checks) console.log('PASS — ' + label);
