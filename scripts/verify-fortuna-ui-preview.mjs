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
const api = read('js/finance/fortuna/api.mjs');
const domain = read('js/finance/fortuna/preview-domain.mjs');
const adminPanel = read('js/finance/orchestration/show-admin-panel.js');
const userPanel = read('js/finance/orchestration/show-user-dashboard.js');
const logout = read('js/session/logout.js');
const navigation = read('js/ui/navigation.js');
const sw = read('service-worker.js');
const app = read('js/core/app.js');
const settlementSql = read('supabase/migrations/20261122173537_fortuna_v1_private_ledger_and_owner_api.sql');
const dispatcher = read('supabase/functions/fortuna-dispatch/index.ts');
const settlementApiTest = read('scripts/verify-fortuna-owner-settlement-api.mjs');

assert.match(html, /<li id="fortuna-link-item" style="display: none;">[\s\S]*loadSection\('fortuna'\)/);
assert.match(adminPanel, /fortuna-link-item/);
assert.match(adminPanel, /fortunaItem[\s\S]{0,100}style\.display = ''/);
assert.match(userPanel, /fortuna-link-item/);
assert.match(userPanel, /style\.display = ''/);
assert.match(navigation, /seccionesCompartidas/);
assert.match(navigation, /'fortuna'/);
assert.match(navigation, /loadFortunaData/);
assert.match(adminPanel, /resetFortunaPreviewDrafts/);
assert.match(userPanel, /resetFortunaPreviewDrafts/);
assert.match(logout, /resetFortunaPreviewDrafts/);
assert.match(ui, /window\.resetFortunaPreviewDrafts/);
assert.match(ui, /window\.loadFortunaData/);
assert.match(html, /id="shared-fortuna" class="section hidden fortuna-page" data-fortuna-live="true"/);
const adminStart = html.indexOf('<div id="admin-panel"');
const sharedStart = html.indexOf('<div id="shared-fortuna"');
const adminPrefix = html.slice(adminStart, sharedStart).replace(/<!--[\s\S]*?-->/g, '');
assert.ok(adminStart >= 0 && sharedStart > adminStart, 'Shared FORTUNA view must follow the admin panel');
assert.equal((adminPrefix.split('<div').length - 1) - (adminPrefix.split('</div>').length - 1), 0, 'Shared FORTUNA must be outside the admin panel');
assert.doesNotMatch(html, /id="admin-fortuna"/);
assert.match(html, /Libro personal del propietario autenticado/);
assert.match(html, /Información persistente y privada del propietario autenticado/);
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
  'fortuna-preview-history-list',
  'fortuna-refresh-btn'
]) {
  assert.ok(html.includes('id="' + id + '"'), 'Missing UI element: ' + id);
}
assert.match(html, /maxlength="120"/);
assert.match(html, /maxlength="40"/);
assert.match(html, /maxlength="1000"/);
assert.match(html, /maxlength="500"/);
assert.match(html, /id="fortuna-new-obligation-btn" class="btn btn-secondary" disabled/);
assert.doesNotMatch(html, /fortuna-obligation-due-date/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /Te debe[\s\S]*Le debes/);
assert.match(html, /CUP[\s\S]*USD[\s\S]*EUR/);
assert.match(html, /ui\.js\?v=163/);
assert.equal(sw.match(/const CACHE_NAME = 'cuevacoin-shell-v(\d+)'/)?.[1], '163');
assert.equal(html.match(/const VERSION_FALLBACK = 'V\.(\d+)'/)?.[1], '163');
assert.equal(app.match(/const VERSION_FALLBACK = 'V\.(\d+)'/)?.[1], '163');
assert.match(sw, /\/js\/finance\/fortuna\/ui\.js\?v=163/);
assert.match(sw, /\/js\/finance\/fortuna\/preview-domain\.mjs/);
assert.match(sw, /\/js\/finance\/fortuna\/api\.mjs/);

// The UI performs no direct requests and uses only the authenticated dispatcher module.
assert.match(ui, /from '\.\/api\.mjs'/);
assert.match(ui, /createContact\(/);
assert.match(ui, /openObligation\(/);
assert.match(ui, /listContacts\(/);
assert.match(ui, /listObligations\(/);
assert.match(ui, /createIdempotencyKey/);
assert.match(ui, /renderSettlementWorkbench/);
assert.match(ui, /previewSettlementDraft/);
assert.match(ui, /confirmSettlementDraft/);
assert.match(ui, /invalidateSettlementPreview/);
assert.match(ui, /settlementPreviewRequest/);
assert.match(ui, /pendingCommit/);
assert.match(ui, /data-settlement-preview/);
assert.match(ui, /data-settlement-commit/);
assert.match(ui, /data-settlement-overage-confirm/);
assert.match(ui, /STALE_PREVIEW/);
assert.match(ui, /IDEMPOTENCY_CONFLICT/);
assert.match(ui, /sessionEpoch/);
assert.match(api, /functions\.invoke\(EDGE_FUNCTION/);
assert.match(api, /Authorization: 'Bearer ' \+ accessToken/);
assert.match(api, /ALLOWED_OPERATIONS/);
assert.match(api, /validateSettlementPreview/);
assert.match(api, /validateSettlementCommit/);
assert.match(api, /STALE_PREVIEW/);
assert.match(html, /fortuna-settlement-workbench/);
assert.match(html, /fortuna-settlement-confirmation/);
assert.match(dispatcher, /fortuna_stale_preview/);
assert.match(dispatcher, /STALE_PREVIEW/);
for (const operation of ['create_contact','open_obligation','list_contacts','list_obligations','preview_settlement','receive_cash','pay_contact']) {
  assert.ok(api.includes("'" + operation + "'"), 'Missing allowlisted API operation ' + operation);
}
assert.doesNotMatch(api, /service_role|serviceRole|fetch\(/i);
assert.doesNotMatch(api, /localStorage|sessionStorage|indexedDB/);
assert.doesNotMatch(ui, /createClient\(|supabaseClient|fetch\(|\.rpc\(|localStorage|sessionStorage|indexedDB|innerHTML/);
assert.match(ui, /replaceChildren\(\)/);
assert.match(ui, /textContent/);
assert.match(domain, /BigInt\(whole\) \* 100n/);

// Exact money parsing, currency allowlist and integer bounds.
assert.deepEqual(FORTUNA_CURRENCIES, ['CUP', 'USD', 'EUR']);
assert.equal(parseMoneyToMinor('125'), '12500');
assert.equal(parseMoneyToMinor('125,5'), '12550');
assert.equal(parseMoneyToMinor('125.05'), '12505');
assert.equal(parseMoneyToMinor('0,01'), '1');
assert.equal(parseMoneyToMinor('92233720368547758.07'), MAX_MINOR_UNITS.toString());
assert.throws(() => parseMoneyToMinor('92233720368547758.08'));
assert.throws(() => parseMoneyToMinor('9'.repeat(21)));
for (const invalid of ['', '0', '0.00', '-1', '+1', '01', '1.234', '1,2.3', '1 000', '1,', '  ', 'NaN']) {
  assert.throws(() => parseMoneyToMinor(invalid), undefined, 'Invalid amount: ' + JSON.stringify(invalid));
}
assert.equal(formatMinorAmount('0'), '0,00');
assert.equal(formatMinorAmount('125050'), '1 250,50');
assert.throws(() => formatMinorAmount('-100'));
assert.throws(() => formatMinorAmount((MAX_MINOR_UNITS + 1n).toString()));

assert.deepEqual(normalizeContactDraft({ name: '  María  ', phone: ' 123 ', notes: ' nota ' }), {
  displayName: 'María', phone: '123', notes: 'nota'
});
assert.throws(() => normalizeContactDraft({ name: '   ' }));
assert.throws(() => normalizeContactDraft({ name: 'x'.repeat(121) }));
assert.throws(() => normalizeContactDraft({ name: 'ok', phone: 'x'.repeat(41) }));
assert.throws(() => normalizeContactDraft({ name: 'ok', notes: 'x'.repeat(1001) }));
assert.deepEqual(validateObligationDraft({
  direction: 'receivable', currency: 'CUP', amount: '12,34', description: ' Préstamo '
}), { direction: 'receivable', currency: 'CUP', amountMinor: '1234', description: 'Préstamo' });
assert.throws(() => validateObligationDraft({ direction: 'receivable', currency: 'GBP', amount: '12', description: 'Concepto' }));
assert.throws(() => validateObligationDraft({ direction: 'payable', currency: 'USD', amount: '0', description: 'Concepto' }));
assert.throws(() => validateObligationDraft({ direction: 'payable', currency: 'EUR', amount: '12', description: ' ' }));

// Any same-currency mixed position remains gross and unnetted.
assert.deepEqual(summarizeObligations([
  { currency: 'CUP', direction: 'receivable', amountMinor: '10000' },
  { currency: 'CUP', direction: 'payable', amountMinor: '4000' },
  { currency: 'USD', direction: 'receivable', amountMinor: '2500' }
]), [
  { currency: 'CUP', receivableMinor: '10000', payableMinor: '4000', mixed: true },
  { currency: 'USD', receivableMinor: '2500', payableMinor: '0', mixed: false }
]);
assert.throws(() => summarizeObligations([
  { currency: 'CUP', direction: 'receivable', amountMinor: MAX_MINOR_UNITS.toString() },
  { currency: 'CUP', direction: 'receivable', amountMinor: '1' }
]), /supera el máximo admitido/);
assert.throws(() => summarizeObligations([
  { currency: 'CUP', direction: 'receivable', amountMinor: '-1' }
]));

// Server settlement remains authoritative: preview fingerprint, stale rejection, overage and idempotency.
assert.match(settlementSql, /CREATE OR REPLACE FUNCTION api\.preview_settlement\([\s\S]*?p_contact_id uuid,[\s\S]*?p_currency_code text,[\s\S]*?p_flow text,[\s\S]*?p_mode text,[\s\S]*?p_total_amount_minor text,[\s\S]*?p_requested_allocations jsonb/);
assert.match(settlementSql, /CREATE OR REPLACE FUNCTION api\.receive_cash\([\s\S]*?p_preview_fingerprint text,[\s\S]*?p_confirm_overage boolean,[\s\S]*?p_idempotency_key text/);
assert.match(settlementSql, /CREATE OR REPLACE FUNCTION api\.pay_contact\([\s\S]*?p_preview_fingerprint text,[\s\S]*?p_confirm_overage boolean,[\s\S]*?p_idempotency_key text/);
assert.match(settlementSql, /pg_catalog\.sha256\(/);
assert.match(settlementSql, /'preview_fingerprint', v_fingerprint/);
assert.match(settlementSql, /IF v_plan->>'preview_fingerprint' <> v_preview_fingerprint THEN\s+RAISE EXCEPTION 'fortuna_stale_preview'/);
assert.match(settlementSql, /ON CONFLICT \(book_id, actor_user_id, idempotency_key\) DO NOTHING/);
assert.match(settlementSql, /IF v_existing_hash <> v_payload_hash THEN\s+RAISE EXCEPTION 'fortuna_idempotency_conflict'/);
assert.match(settlementSql, /IF v_overage > 0 AND p_confirm_overage IS NOT TRUE THEN\s+RAISE EXCEPTION 'fortuna_overage_confirmation_required'/);
assert.match(settlementSql, /INSERT INTO fortuna_private\.financial_events/);
assert.match(settlementSql, /INSERT INTO fortuna_private\.financial_allocations/);
assert.match(settlementSql, /INSERT INTO fortuna_private\.financial_ledger_entries/);
assert.match(dispatcher, /preview_settlement: 'preview_settlement'/);
assert.match(dispatcher, /receive_cash: 'receive_cash'/);
assert.match(dispatcher, /pay_contact: 'pay_contact'/);
assert.match(dispatcher, /Authorization: authHeader/);
assert.match(dispatcher, /supabase\.schema\('api'\)\.rpc\(rpc, body\.args\)/);
assert.doesNotMatch(dispatcher, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(settlementApiTest, /FIFO preview proposes oldest-first allocations and returns a SHA-256 fingerprint/);
assert.match(settlementApiTest, /stale preview detects an intervening settlement/);
assert.match(settlementApiTest, /exact retry replays without duplicates/);

console.log('PASS — FORTUNA V163 owner UI, authenticated API client, persisted contact/obligation flows, session isolation, exact money and authoritative settlement contracts.');
