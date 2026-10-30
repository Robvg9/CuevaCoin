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
const users = read('js/admin/finance/usuarios.js');

assert.match(sw, /cuevacoin-shell-v149/);
assert.match(index, /VERSION_FALLBACK = 'V\\.149'/);
assert.match(app, /VERSION_FALLBACK = 'V\\.149'/);
assert.match(index, /usuarios\\.js\\?v=149/);

// V148 offline-first behavior remains in V149.
assert.match(index, /comprobarActualizacionAutomatica/);
assert.match(index, /registration\\.update\\(\\)/);
assert.match(index, /60 \\* 60 \\* 1000/);
assert.match(stats, /cuevacoin_admin_stats_v1:/);
assert.match(stats, /pintarResumen\\(cached, 'cache'\\)/);
assert.match(stats, /if \\(error\\) throw error/);
assert.match(stats, /Sin conexión y sin un resumen anterior guardado/);
assert.match(index, /id="admin-stats-cache-status"/);
assert.match(history, /cuevacoin-offline-read-cache/);
assert.match(history, /indexedDB\\.open/);
assert.match(history, /Sin conexión · mostrando la última copia guardada/);
assert.match(history, /admin-history-tx-card/);
assert.match(userDashboard, /item\\.style\\.display = 'none'/);
assert.match(adminDashboard, /item\\.style\\.display = ''/);

// Compact user list retains the data and all management controls.
assert.match(users, /usuario-card-compacto/);
assert.match(users, /usuario-card-identidad/);
assert.match(users, /usuario-card-info/);
assert.match(users, /usuario-card-correo/);
assert.match(users, /usuario-card-meta/);
assert.match(users, /usuario-card-archivado/);
assert.match(users, /abrirHistorialTrabajadoraAdmin/);
assert.match(users, /openAjustarSaldoModal/);
assert.match(users, /eliminarUsuario/);
assert.match(users, /archivarUsuario/);
assert.match(users, /restaurarUsuario/);
assert.match(users, /formatearUltimaVez/);
assert.match(users, /metaAhorro/);
assert.match(index, /#admin-usuarios-seccion \\.usuario-card-compacto/);
assert.match(index, /grid-template-columns: repeat\\(4, minmax\\(0, 1fr\\)\\)/);
assert.match(index, /#admin-usuarios-seccion \\.usuario-card-archivado \\.usuario-card-acciones/);
assert.match(index, /#admin-usuarios-seccion \\.usuario-card-correo/);

console.log('PASS — V149 release/version/cache-busting assets aligned');
console.log('PASS — V148 offline dashboard, local history and automatic PWA update checks preserved');
console.log('PASS — V149 user cards condensed while retaining identity, status, balance, email, activity and savings goal');
console.log('PASS — V149 preserves history, balance adjustment, activate/deactivate, archive and restore actions');
