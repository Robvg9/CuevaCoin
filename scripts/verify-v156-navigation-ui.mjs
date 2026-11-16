import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const read = (path) => readFileSync(path, 'utf8');
const index = read('index.html');
const app = read('js/core/app.js');
const dots = read('js/ui/menu-dots.js');
const panel = read('js/ui/notif-panel.js');
const notifications = read('js/data/notifications.js');
const sw = read('service-worker.js');

const sidebarStart = index.indexOf('<div id="sidebar"');
const topbarStart = index.indexOf('<div id="app-topbar"');
assert.ok(sidebarStart >= 0 && topbarStart > sidebarStart, 'Sidebar and topbar must exist');
const sidebar = index.slice(sidebarStart, topbarStart);
const topbarEnd = index.indexOf('<!-- Login Screen', topbarStart);
const topbar = index.slice(topbarStart, topbarEnd);
assert.doesNotMatch(sidebar, /Cerrar Sesión/i, 'Logout must no longer live in the sidebar');
assert.match(topbar, /id="topbar-avatar"[\s\S]*?class="topbar-logout-btn"/, 'Logout must sit beside the avatar in the topbar');
assert.match(topbar, /openModal\('confirmar-logout-modal'\)/, 'Topbar logout must retain the existing confirmation modal');
assert.match(topbar, /aria-label="Cerrar sesión"/, 'Topbar logout must be accessible');

assert.match(index, /cuevacoin-v156-visual-navigation/, 'V156 responsive visual layer must be present');
assert.match(index, /@media \(max-width: 560px\)[\s\S]*?\.topbar-logout-label\s*\{\s*display:\s*none/s, 'Logout label must collapse on small screens');
assert.match(index, /:focus-visible/, 'Visible keyboard/touch focus treatment must be present');
assert.match(index, /VERSION_FALLBACK = 'V\.156'/, 'HTML fallback must identify V156');
assert.match(app, /VERSION_FALLBACK = 'V\.156'/, 'App fallback must identify V156');
assert.match(sw, /cuevacoin-shell-v156/, 'PWA cache must be versioned to V156');
for (const path of ['js/core/app.js?v=156','js/data/notifications.js?v=156','js/ui/menu-dots.js?v=156','js/ui/notif-panel.js?v=156']) {
  assert.ok(index.includes(path), 'Changed module must be cache-busted: ' + path);
}

assert.match(dots, /const hayAviso = !!hayNotif;/, 'Global hamburger dot must depend only on real unread notifications');
assert.doesNotMatch(dots, /const hayAviso = !!hayNovedad \|\| !!hayNotif/, 'Legacy product-announcement flags must not keep the global dot lit');
assert.match(dots, /NOVEDADES_MENU/, 'Per-section announcement badges must remain available');
assert.match(notifications, /\.eq\('leida', false\)/, 'Unread notification count must stay scoped to unread records');

assert.match(panel, /\.update\(\{ leida: true \}\)[\s\S]*?\.eq\('usuario_id', usuarioId\)[\s\S]*?\.eq\('leida', false\)/, 'Opening notification panel must clear all unread records for the active user');
assert.doesNotMatch(panel, /\.in\('id', idsNoLeidas\)/, 'Unread clearing must not be restricted to only the newest 20 IDs');

// Exercise the actual module with mocked DOM globals: an old unviewed feature notice
// must not show the hamburger badge; a real unread notification must show it.
function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      const next = typeof force === 'boolean' ? force : !values.has(name);
      if (next) values.add(name); else values.delete(name);
      return next;
    }
  };
}
const dotMenu = { classList: classList(['hidden']) };
const wrap = { classList: classList() };
globalThis.document = {
  getElementById(id) { return id === 'notif-dot-menu' ? dotMenu : null; },
  querySelector(selector) { return selector === '.menu-toggle-wrap' ? wrap : null; }
};
globalThis.window = { hayNovedadMenuGlobal: true, hayNotifSinLeerGlobal: false };
const moduleUrl = pathToFileURL(resolve('js/ui/menu-dots.js')).href + '?v156-regression';
const menuDots = await import(moduleUrl);
menuDots.actualizarDotMenuUnico();
assert.equal(dotMenu.classList.contains('hidden'), true, 'Old menu announcement must not show global hamburger badge');
assert.equal(wrap.classList.contains('tiene-aviso'), false, 'No global highlight without unread notifications');
globalThis.window.hayNotifSinLeerGlobal = true;
menuDots.actualizarDotMenuUnico();
assert.equal(dotMenu.classList.contains('hidden'), false, 'Real unread notifications must show hamburger badge');
assert.equal(wrap.classList.contains('tiene-aviso'), true, 'Real unread notifications must highlight hamburger');
globalThis.window.hayNotifSinLeerGlobal = false;
menuDots.actualizarDotMenuUnico();
assert.equal(dotMenu.classList.contains('hidden'), true, 'Badge must clear when no unread notifications remain');
assert.equal(wrap.classList.contains('tiene-aviso'), false, 'Highlight must clear with the badge');

console.log('PASS — V156 header logout placement and responsive styles');
console.log('PASS — global hamburger badge ignores stale feature-announcement state');
console.log('PASS — real unread notifications still light the bell and hamburger');
console.log('PASS — opening notification panel clears all unread records for the active user');
console.log('PASS — V156 HTML, JS fallback, Service Worker cache and module URLs are aligned');
