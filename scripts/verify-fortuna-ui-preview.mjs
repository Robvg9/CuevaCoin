import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const html = read('index.html');
const tabs = read('js/finance/fortuna/ui.js');
const adminPanel = read('js/finance/orchestration/show-admin-panel.js');
const userPanel = read('js/finance/orchestration/show-user-dashboard.js');
const sw = read('service-worker.js');
const app = read('js/core/app.js');

assert.match(html, /<li id="fortuna-link-item" style="display: none;">[\s\S]*loadSection\('fortuna'\)/,
  'FORTUNA preview link must start hidden in the sidebar');
assert.match(adminPanel, /fortuna-link-item/,
  'Admin panel may reveal the preview menu item');
assert.match(userPanel, /fortuna-link-item[\s\S]{0,160}style\.display = 'none'/,
  'Worker sessions must hide the FORTUNA menu item');
assert.match(html, /<div id="admin-fortuna" class="section hidden fortuna-page" data-fortuna-preview="true">/,
  'Preview screen must live inside the admin panel');
assert.match(html, /Modo de preparación protegido/,
  'Preview must explain that production data is not queried');
assert.match(html, /No se consultan contactos en esta vista/,
  'The contacts empty state must not imply live data access');
assert.match(html, /id="fortuna-panel-overview"[\s\S]*?id="fortuna-panel-contacts"[\s\S]*?id="fortuna-panel-history"/,
  'Overview, contacts and history panels must exist');
assert.equal((html.match(/data-fortuna-tab="/g) || []).length, 3,
  'Preview must expose exactly three tab controls');
assert.match(html, /class="btn btn-primary" disabled[\s\S]*Nuevo contacto/,
  'Contact creation must remain disabled in preview');
assert.match(html, /class="btn btn-secondary" disabled[\s\S]*Registrar obligación/,
  'Obligation creation must remain disabled in preview');
assert.match(html, /Por cobrar/, 'Preview must distinguish receivables');
assert.match(html, /Por pagar/, 'Preview must distinguish payables');
assert.match(html, /CUP[\s\S]*USD[\s\S]*EUR/, 'Preview must reflect the approved v1 currency allowlist');
assert.match(html, /Te debe[\s\S]*Le debes/, 'Preview must show both gross directions, not a net balance');
for (const forbidden of ['createClient(', 'supabaseClient', 'fetch(', '.rpc(', '.from(']) {
  assert.equal(tabs.includes(forbidden), false, 'Preview tab logic must not contain ' + forbidden);
}
assert.match(tabs, /ArrowRight|ArrowLeft/, 'Preview tabs must support keyboard navigation');
assert.match(html, /src="js\/finance\/fortuna\/ui\.js\?v=159"/,
  'Preview UI module must use a cache-busting versioned URL');
assert.equal(sw.match(/const CACHE_NAME = 'cuevacoin-shell-v(\d+)'/)?.[1], '159',
  'Service worker cache version must be bumped to V159');
assert.equal(html.match(/const VERSION_FALLBACK = 'V\.(\d+)'/)?.[1], '159',
  'HTML fallback version must match the shell cache');
assert.equal(app.match(/const VERSION_FALLBACK = 'V\.(\d+)'/)?.[1], '159',
  'App fallback version must match the shell cache');

console.log('PASS — FORTUNA preview is admin-only, read-only, data-free and cache-versioned; no Supabase/network writes are present.');
