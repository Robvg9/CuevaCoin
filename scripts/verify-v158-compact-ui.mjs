import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync('index.html', 'utf8');
const app = readFileSync('js/core/app.js', 'utf8');
const sw = readFileSync('service-worker.js', 'utf8');

const transferActions = index.match(/class="btn btn-secondary transfer-recipient-action"/g) || [];
assert.equal(transferActions.length, 3, 'Transfer recipient flow must expose exactly three compact actions');
for (const id of ['btn-escanear-qr-transferir', 'btn-mi-qr-transferir', 'btn-buscar-usuario-transferir']) {
  const start = index.indexOf('id="' + id + '"');
  assert.ok(start >= 0, 'Missing transfer action ' + id);
  const button = index.slice(start, index.indexOf('</button>', start) + 9);
  assert.match(button, /aria-label=/, id + ' must have an accessible name');
  assert.match(button, /transfer-action-icon/, id + ' must use icon-first compact layout');
}
assert.match(index, /transfer-recipient-actions[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, 'Transfer actions must use a compact three-column grid');
assert.match(index, /admin-quick-action/g, 'Admin quick actions must use compact icon-first markup');
for (const action of ['Pagar salario', 'Dar bono', 'Anuncio', 'Reporte']) assert.ok(index.includes(action), 'Admin action label must remain understandable: ' + action);
assert.match(index, /VERSION_FALLBACK = 'V\.158'/, 'HTML fallback must identify V158');
assert.match(app, /VERSION_FALLBACK = 'V\.158'/, 'App fallback must identify V158');
assert.match(sw, /cuevacoin-shell-v158/, 'Service Worker cache must be versioned to V158');
assert.match(index, /:focus-visible/, 'Keyboard/touch focus treatment must remain available');
assert.match(index, /prefers-reduced-motion/, 'Reduced-motion preference must be respected');
console.log('PASS — V158 transfer recipient actions are compact, icon-first and accessible');
console.log('PASS — administrator quick actions retain concise labels and icon-first layout');
console.log('PASS — HTML, app fallback and PWA cache versions are aligned to V158');
console.log('PASS — focus-visible and reduced-motion accessibility contracts');
