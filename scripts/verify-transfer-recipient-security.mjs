import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = (path) => readFileSync(path, 'utf8');
const lookup = read('js/finance/transfers/buscar-usuario.js');
const transfer = read('js/finance/transfers/ejecutar-transferencia.js');
const favorites = read('js/finance/transfers/favoritos.js');
const qrClient = read('js/finance/transfers/qr-scanner.js');
const password = read('js/finance/transfers/password-confirm.js');
const queue = read('js/finance/queue/offline-queue.js');
const legacy = read('js/legacy-app.js');
const index = read('index.html');
const transferEdge = read('supabase/functions/transferir-saldo/index.ts');
const qrEdge = read('supabase/functions/resolver-cuenta-qr/index.ts');
const userEdge = read('supabase/functions/resolver-cuenta-usuario/index.ts');
const migration = read('supabase/migrations/20261121110000_transfer_recipient_id_privacy_active_admin.sql');
const sqlTest = read('supabase/tests/transfer_recipient_privacy_and_admin_active.sql');

assert.match(lookup, /resolver_destinatario_transferencia_v2/);
assert.match(lookup, /id: fila\.id/);
assert.doesNotMatch(lookup, /fila\.correo|correo:\s*correo/);
assert.match(lookup, /transferenciaDestinatarioSeleccionado/);
assert.match(lookup, /window\.transferenciaViaQR = Boolean\(viaQR\)/);
assert.match(transfer, /body:\s*\{\s*destinatarioId, cantidad, motivo, idempotencyKey\s*\}/);
assert.doesNotMatch(transfer, /destinatarioCorreo/);
assert.match(favorites, /favorito:favorito_id\(nombre, usuario, estado\)/);
assert.doesNotMatch(favorites, /correo/);
assert.match(qrClient, /establecerDestinatarioTransferencia\(\{ id: data\.id/);
assert.doesNotMatch(qrClient, /data\.correo/);
assert.match(password, /destinatarioId, destinatarioNombre, cantidad, motivo/);
assert.match(queue, /destinatarioId: item\.datos\.destinatarioId/);
assert.match(queue, /item\.datos\.destinatarioCorreo/);
assert.match(transferEdge, /const destinatarioId = body\.destinatarioId/);
assert.match(transferEdge, /Legacy compatibility only/);
assert.match(transferEdge, /transferir_saldo_atomica/);
assert.match(qrEdge, /id: destinatario\.id/);
assert.match(userEdge, /id: destinatario\.id/);
assert.doesNotMatch(qrEdge, /destinatario\.correo|correo:\s*destinatario/);
assert.doesNotMatch(userEdge, /destinatario\.correo|correo:\s*destinatario/);

const start = legacy.indexOf("document.getElementById('transferir-form').addEventListener('submit'");
const end = legacy.indexOf('// Reautenticación QR', start);
assert.ok(start >= 0 && end > start, 'Transfer submit handler must be present');
const transferHandler = legacy.slice(start, end);
assert.match(transferHandler, /let destinatarioSeleccionado/);
assert.match(transferHandler, /destinatarioSeleccionado\.id/);
assert.match(transferHandler, /ejecutarTransferencia\(destinatarioSeleccionado\.id/);
assert.doesNotMatch(transferHandler, /destinatarioCorreo\s*=/, 'Historic const reassignment/email handoff must be gone');
assert.match(legacy, /ejecutarTransferencia\(destinatarioId, cantidad, motivo, destinatarioNombre\)/);
assert.match(index, /Destinatario \(correo, usuario o nombre\)/);
assert.match(index, /type="text" id="transferir-destinatario-correo"/);

assert.match(migration, /admin_resolver_retiro\(p_solicitud_id uuid, p_aprobar boolean\)/);
assert.match(migration, /admin_resolver_retiro\(p_solicitud_id uuid, p_accion text\)/);
assert.equal((migration.match(/IS DISTINCT FROM 'activo'/g) || []).length, 2, 'Both admin overloads must enforce active status');
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.resolver_destinatario_transferencia_v2/);
assert.match(migration, /RETURNS TABLE\(id uuid, usuario text, nombre text, apellido text, estado text\)/);
assert.doesNotMatch(migration, /REVOKE EXECUTE ON FUNCTION public\.resolver_destinatario_transferencia\(text\)/, 'Legacy RPC stays available during controlled rollout');
assert.match(sqlTest, /resolver_destinatario_transferencia_v2/);
assert.match(sqlTest, /admin_resolver_retiro\(uuid,boolean\)/);
assert.match(sqlTest, /admin_resolver_retiro\(uuid,text\)/);

for (const path of [
  'js/finance/transfers/buscar-usuario.js',
  'js/finance/transfers/ejecutar-transferencia.js',
  'js/finance/transfers/favoritos.js',
  'js/finance/transfers/qr-scanner.js',
  'js/finance/transfers/password-confirm.js',
  'js/finance/transfers/modal-transfer.js',
  'js/finance/queue/offline-queue.js',
  'js/finance/withdrawals/admin-retiros.js'
]) {
  const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: read(path), encoding: 'utf8' });
  assert.equal(syntax.status, 0, 'Invalid JavaScript syntax in ' + path + ': ' + (syntax.stderr || syntax.stdout));
}
const legacySyntax = spawnSync(process.execPath, ['--check'], { input: legacy, encoding: 'utf8' });
assert.equal(legacySyntax.status, 0, 'Invalid legacy-app.js syntax: ' + (legacySyntax.stderr || legacySyntax.stdout));
console.log('PASS — new recipient selection, QR, favorites, transfer execution and offline intents use stable profile IDs.');
console.log('PASS — pre-V157 email-only queue records remain replayable through the explicit compatibility path.');
console.log('PASS — both withdrawal resolver overloads require active admin; the new resolver does not return email.');
console.log('PASS — historic recipient const reassignment regression removed; JavaScript syntax validated.');
