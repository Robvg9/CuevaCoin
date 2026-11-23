import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FORTUNA_CURRENCIES,
  MAX_MINOR_UNITS,
  formatMinorAmount,
  normalizeContactDraft,
  parseMoneyToMinor,
  summarizeObligations,
  validateObligationDraft
} from '../js/finance/fortuna/preview-domain.mjs';

const read = (path) => readFileSync(path, 'utf8');
const html = read('index.html');
const ui = read('js/finance/fortuna/ui.js');
const domain = read('js/finance/fortuna/preview-domain.mjs');
const adminPanel = read('js/finance/orchestration/show-admin-panel.js');
const userPanel = read('js/finance/orchestration/show-user-dashboard.js');
const logout = read('js/session/logout.js');
const navigation = read('js/ui/navigation.js');
const sw = read('service-worker.js');
const app = read('js/core/app.js');

assert.match(html, /<li id="fortuna-link-item" style="display: none;">[\s\S]*loadSection\('fortuna'\)/);
assert.match(adminPanel, /fortuna-link-item/);
assert.match(userPanel, /fortuna-link-item/);
assert.match(userPanel, /style\.display = ''/);
assert.match(navigation, /seccionesCompartidas/);
assert.match(navigation, /'fortuna'/);
assert.match(adminPanel, /resetFortunaPreviewDrafts/);
assert.match(userPanel, /resetFortunaPreviewDrafts/);
assert.match(logout, /resetFortunaPreviewDrafts/);
assert.match(ui, /window\.resetFortunaPreviewDrafts/);
assert.match(html, /id="shared-fortuna" class="section hidden fortuna-page" data-fortuna-preview="true"/);
assert.doesNotMatch(html, /id="admin-fortuna"/);
assert.match(html, /Modo de preparación protegido/);
assert.match(html, /desaparecen al recargar/);
assert.equal((html.match(/data-fortuna-tab="/g) || []).length, 3);

for (const id of [
  'fortuna-contact-dialog',
  'fortuna-contact-form',
  'fortuna-obligation-dialog',
  'fortuna-obligation-form',
  'fortuna-contact-search',
  'fortuna-contact-currency-filter',
  'fortuna-contact-list',
  'fortuna-contact-detail',
  'fortuna-preview-history-list'
]) {
  assert.ok(html.includes('id="' + id + '"'), 'Missing UI element: ' + id);
}
assert.match(html, /maxlength="120"/);
assert.match(html, /maxlength="40"/);
assert.match(html, /maxlength="1000"/);
assert.match(html, /maxlength="500"/);
assert.match(html, /id="fortuna-new-obligation-btn" class="btn btn-secondary" disabled/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /Te debe[\s\S]*Le debes/);
assert.match(html, /CUP[\s\S]*USD[\s\S]*EUR/);
assert.match(html, /ui\.js\?v=160/);
assert.equal(sw.match(/const CACHE_NAME = 'cuevacoin-shell-v(\d+)'/)?.[1], '160');
assert.equal(html.match(/const VERSION_FALLBACK = 'V\.(\d+)'/)?.[1], '160');
assert.equal(app.match(/const VERSION_FALLBACK = 'V\.(\d+)'/)?.[1], '160');

// The UI may manipulate DOM only; it must not make requests or persist financial drafts.
for (const forbidden of [
  'createClient(', 'supabaseClient', 'fetch(', '.rpc(',
  'localStorage', 'sessionStorage', 'indexedDB', 'innerHTML'
]) {
  assert.equal(ui.includes(forbidden), false, 'Preview UI must not contain ' + forbidden);
}
assert.match(ui, /replaceChildren\(\)/);
assert.match(ui, /textContent/);
assert.match(ui, /previewOnly: true/);
assert.match(ui, /state = \{ contacts: \[\], selectedContactId: null/);
assert.match(ui, /activateTab\('contacts'\)/);
assert.match(domain, /BigInt\(whole\) \* 100n/);

// Currency allowlist and exact minor-unit parsing.
assert.deepEqual(FORTUNA_CURRENCIES, ['CUP', 'USD', 'EUR']);
assert.equal(parseMoneyToMinor('125'), '12500');
assert.equal(parseMoneyToMinor('125,5'), '12550');
assert.equal(parseMoneyToMinor('125.05'), '12505');
assert.equal(parseMoneyToMinor('0,01'), '1');
assert.equal(parseMoneyToMinor('92233720368547758.07'), MAX_MINOR_UNITS.toString());
assert.throws(() => parseMoneyToMinor('92233720368547758.08'));
assert.throws(() => parseMoneyToMinor('9'.repeat(21)));

for (const invalid of [
  '', '0', '0.00', '-1', '+1', '01', '1.234',
  '1,2.3', '1 000', '1,', '  ', 'NaN'
]) {
  assert.throws(() => parseMoneyToMinor(invalid), undefined, 'Invalid amount: ' + JSON.stringify(invalid));
}
assert.equal(formatMinorAmount('0'), '0,00');
assert.equal(formatMinorAmount('125050'), '1 250,50');
assert.throws(() => formatMinorAmount('-100'));

assert.deepEqual(normalizeContactDraft({
  name: '  María  ', phone: ' 123 ', notes: ' nota '
}), { displayName: 'María', phone: '123', notes: 'nota' });
assert.throws(() => normalizeContactDraft({ name: '   ' }));
assert.throws(() => normalizeContactDraft({ name: 'x'.repeat(121) }));
assert.throws(() => normalizeContactDraft({ name: 'ok', phone: 'x'.repeat(41) }));
assert.throws(() => normalizeContactDraft({ name: 'ok', notes: 'x'.repeat(1001) }));

assert.deepEqual(validateObligationDraft({
  direction: 'receivable', currency: 'CUP', amount: '12,34', description: ' Préstamo '
}), {
  direction: 'receivable', currency: 'CUP', amountMinor: '1234', description: 'Préstamo'
});
assert.throws(() => validateObligationDraft({
  direction: 'receivable', currency: 'GBP', amount: '12', description: 'Concepto'
}));
assert.throws(() => validateObligationDraft({
  direction: 'payable', currency: 'USD', amount: '0', description: 'Concepto'
}));
assert.throws(() => validateObligationDraft({
  direction: 'payable', currency: 'EUR', amount: '12', description: ' '
}));

// Mixed positions stay gross and independent by currency; nothing is netted.
assert.deepEqual(summarizeObligations([
  { currency: 'CUP', direction: 'receivable', amountMinor: '10000' },
  { currency: 'CUP', direction: 'payable', amountMinor: '4000' },
  { currency: 'USD', direction: 'receivable', amountMinor: '2500' }
]), [
  { currency: 'CUP', receivableMinor: '10000', payableMinor: '4000', mixed: true },
  { currency: 'USD', receivableMinor: '2500', payableMinor: '0', mixed: false }
]);
assert.throws(() => summarizeObligations([
  { currency: 'CUP', direction: 'receivable', amountMinor: '-1' }
]));

console.log('PASS — FORTUNA preview UI, local-only draft boundary, contact/obligation validation, exact money, limits, mixed balances and currency isolation.');
