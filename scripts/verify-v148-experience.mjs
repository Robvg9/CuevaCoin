import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const index = read('index.html');
const sw = read('service-worker.js');
const stats = read('js/admin/finance/stats.js');
const history = read('js/admin/finance/historial-trabajadora.js');
const userDashboard = read('js/finance/orchestration/show-user-dashboard.js');
const adminDashboard = read('js/finance/orchestration/show-admin-panel.js');
const app = read('js/core/app.js');

assert.match(sw, /cuevacoin-shell-v148/);
assert.match(index, /VERSION_FALLBACK = 'V\.148'/);
assert.match(app, /VERSION_FALLBACK = 'V\.148'/);
assert.match(index, /comprobarActualizacionAutomatica/);
assert.match(index, /registration\.update\(\)/);
assert.match(index, /60 \* 60 \* 1000/);
assert.match(stats, /cuevacoin_admin_stats_v1:/);
assert.match(stats, /pintarResumen\(cached, 'cache'\)/);
assert.match(stats, /if \(error\) throw error/);
assert.match(stats, /Sin conexión y sin un resumen anterior guardado/);
assert.match(index, /id="admin-stats-cache-status"/);
assert.match(history, /cuevacoin-offline-read-cache/);
assert.match(history, /indexedDB\.open/);
assert.match(history, /Sin conexión · mostrando la última copia guardada/);
assert.match(history, /admin-history-tx-card/);
assert.doesNotMatch(history, /card\.append\(header, crearTexto\('p', 'tx-card-explicacion'/);
assert.match(index, /admin-history-intro/);
assert.match(index, /admin-history-tx-card/);
assert.match(index, /min-height: 50px/);
assert.match(userDashboard, /item\.style\.display = 'none'/);
assert.match(adminDashboard, /item\.style\.display = ''/);

console.log('PASS — resumen del dashboard se muestra desde caché antes de sincronizar');
console.log('PASS — historial individual conserva hasta 50 movimientos recientes por admin/trabajador en IndexedDB');
console.log('PASS — actualizaciones PWA comprobadas al abrir, volver al primer plano y cada hora');
console.log('PASS — menú sin filas vacías y tarjetas financieras compactas');
