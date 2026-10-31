import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const usersSource = readFileSync('js/admin/finance/usuarios.js', 'utf8');
const historySource = readFileSync('js/finance/history/historial.js', 'utf8');
const chatDomSource = readFileSync('js/chat/chat-dom.js', 'utf8');
const utilsSource = readFileSync('js/core/utils.js', 'utf8');
const indexSource = readFileSync('index.html', 'utf8');

function assertNoHtmlInjectionSinks(source, label) {
    assert.doesNotMatch(source, /\binnerHTML\s*=|\bouterHTML\s*=|insertAdjacentHTML\s*\(/i,
        label + ' must not write untrusted data through HTML parsing APIs');
    assert.doesNotMatch(source, /\bonclick\s*=|\.onclick\s*=/i,
        label + ' must not construct inline event handlers');
    assert.match(source, /textContent/);
    assert.match(source, /addEventListener/);
}

const additionalSafeDomModules = [
    'js/finance/transfers/favoritos.js',
    'js/admin/finance/destinatarios.js',
    'js/finance/withdrawals/admin-solicitudes-ui.js',
    'js/admin/correo-lista.js',
    'js/admin/sugerencias-admin.js',
    'js/admin/finance/auditoria.js',
    'js/admin/finance/reportes.js',
    'js/chat/chat-dom.js',
    'js/chat/chat-nav.js',
    'js/chat/chat-messages.js',
    'js/chat/chat-scroll.js',
    'js/core/app.js',
    'js/core/utils.js',
    'js/ui/notif-panel.js',
    'js/ui/sugerencias-user.js',
    'js/profile/qr-display.js'
];

for (const modulePath of additionalSafeDomModules) {
    const source = readFileSync(modulePath, 'utf8');
    assert.doesNotMatch(source, /\binnerHTML\s*=|\bouterHTML\s*=|insertAdjacentHTML\s*\(/i,
        modulePath + ' must not parse dynamic content as HTML');
    assert.doesNotMatch(source, /\bonclick\s*=|\.onclick\s*=/i,
        modulePath + ' must not build inline event handlers');
}

console.log('PASS — 16 additional admin, finance, chat, notification, profile and app modules contain no HTML parsing sinks or inline handlers');

assert.doesNotMatch(indexSource, /\binnerHTML\s*=|\bouterHTML\s*=|insertAdjacentHTML\s*\(/i,
    'index.html must not assign untrusted data to HTML parsing APIs');
assert.match(utilsSource, /toast\.textContent\s*=\s*message/,
    'showToast must render message text, not interpret it as HTML');
console.log('PASS — index.html has no HTML-parsing assignments and showToast uses textContent');

class FakeClassList {
    constructor(element) {
        this.element = element;
    }
    add(...names) {
        const tokens = new Set(this.element.className.split(/\s+/).filter(Boolean));
        names.forEach(name => tokens.add(name));
        this.element.className = Array.from(tokens).join(' ');
    }
    remove(...names) {
        const removed = new Set(names);
        this.element.className = this.element.className.split(/\s+/)
            .filter(name => name && !removed.has(name)).join(' ');
    }
    contains(name) {
        return this.element.className.split(/\s+/).includes(name);
    }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this.children = [];
        this.className = '';
        this.classList = new FakeClassList(this);
        this.dataset = {};
        this.listeners = new Map();
        this.textContent = '';
        this.value = '';
    }
    set innerHTML(_value) {
        throw new Error('Unsafe innerHTML assignment detected during the regression test');
    }
    get innerHTML() {
        return undefined;
    }
    appendChild(child) {
        this.children.push(child);
        return child;
    }
    replaceChildren(...children) {
        this.children = children;
    }
    addEventListener(type, callback) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(callback);
        this.listeners.set(type, handlers);
    }
    dispatch(type) {
        for (const callback of this.listeners.get(type) || []) callback({ target: this });
    }
}

function makeDom(ids) {
    const nodes = new Map();
    for (const [id, value] of Object.entries(ids)) {
        const node = new FakeElement('div');
        if (value && typeof value === 'object') Object.assign(node, value);
        nodes.set(id, node);
    }
    return {
        nodes,
        document: {
            getElementById(id) {
                return nodes.get(id) || null;
            },
            createElement(tag) {
                return new FakeElement(tag);
            },
            createTextNode(value) {
                const node = new FakeElement('#text');
                node.textContent = String(value);
                return node;
            }
        }
    };
}

function findAll(node, predicate, found = []) {
    if (predicate(node)) found.push(node);
    for (const child of node.children || []) findAll(child, predicate, found);
    return found;
}

function textTree(node) {
    return String(node.textContent || '') + (node.children || []).map(textTree).join('');
}

function loadClassicCompatibleModule(source, sandbox, label) {
    // These browser modules contain named exports but no import dependencies.
    // Removing only the export keyword lets the regression execute the same body in a VM.
    const executable = source.replace(/^export\s+/gm, '');
    vm.runInNewContext(executable, sandbox, { filename: label });
}

async function testAdminUsersRendering() {
    const maliciousName = '<img src=x onerror="window.__xssExecuted=true">';
    const maliciousUser = "user');window.__xssExecuted=true;//";
    const maliciousEmail = '"><svg onload="window.__xssExecuted=true">';
    const maliciousId = "id');window.__xssExecuted=true;//";
    const dom = makeDom({
        'filter-estado': { value: 'todos' },
        'search-usuario': { value: '' },
        'admin-usuarios-cards': {},
        'admin-usuarios-vacio': { className: 'hidden' }
    });
    const calls = [];
    const window = {
        location: { origin: 'https://cuevacoin.example' },
        __xssExecuted: false,
        formatearUltimaVez: () => 'hoy',
        abrirHistorialTrabajadoraAdmin: id => calls.push(['history', id]),
        openAjustarSaldoModal: id => calls.push(['adjust', id]),
        eliminarUsuario: id => calls.push(['toggle', id]),
        archivarUsuario: id => calls.push(['archive', id]),
        restaurarUsuario: id => calls.push(['restore', id])
    };
    const sandbox = {
        window,
        document: dom.document,
        obtenerTrabajadoras: async () => [{
            id: maliciousId,
            nombre: maliciousName,
            usuario: maliciousUser,
            correo: maliciousEmail,
            foto: 'javascript:window.__xssExecuted=true',
            estado: 'activo',
            saldo: 125.5,
            ultimaConexion: '2026-10-30T10:00:00Z',
            metaAhorro: 250
        }],
        console,
        URL
    };

    loadClassicCompatibleModule(usersSource, sandbox, 'usuarios.js');
    await window.loadAdminUsuarios();

    const cards = dom.nodes.get('admin-usuarios-cards');
    assert.equal(cards.children.length, 1, 'one user card should be rendered');
    const card = cards.children[0];
    const byClass = className => findAll(card, node => node.className.split(/\s+/).includes(className))[0];

    assert.equal(byClass('usuario-card-nombre').textContent, maliciousName,
        'profile names must be rendered as literal text');
    assert.equal(byClass('usuario-card-usuario').textContent, '@' + maliciousUser,
        'usernames must be rendered as literal text');
    assert.equal(byClass('usuario-card-correo').textContent, '✉ ' + maliciousEmail,
        'email addresses must be rendered as literal text');

    const avatar = findAll(card, node => node.tagName === 'IMG')[0];
    assert.ok(avatar.src.startsWith('https://'), 'javascript: avatar URLs must be replaced with a safe HTTPS fallback');
    assert.equal(window.__xssExecuted, false, 'malicious profile fields must not execute');

    const buttons = findAll(card, node => node.tagName === 'BUTTON');
    assert.equal(buttons.length, 4, 'history, adjust, activate/deactivate and archive actions remain visible');
    buttons.forEach(button => button.dispatch('click'));
    assert.deepEqual(calls.map(call => Array.from(call)), [
        ['history', maliciousId],
        ['adjust', maliciousId],
        ['toggle', maliciousId],
        ['archive', maliciousId]
    ], 'button listeners must pass the original identifier without inline JavaScript interpolation');
    assert.equal(window.__xssExecuted, false, 'clicking actions must not execute injected data');
}

async function testUserHistoryRendering() {
    const maliciousReason = '<img src=x onerror="window.__xssExecuted=true">';
    const maliciousAdmin = "Admin');window.__xssExecuted=true;//";
    const maliciousCounterpart = "Counterpart');window.__xssExecuted=true;//";
    const maliciousCounterpartId = "target');window.__xssExecuted=true;//";
    const transaction = {
        id: 'tx-1',
        usuario_id: 'worker-1',
        tipo: 'transferencia',
        cantidad: 25,
        motivo: maliciousReason,
        creado_en: '2026-10-30T12:00:00.000Z',
        saldo_antes: 100,
        saldo_despues: 125,
        admin: { nombre: maliciousAdmin, usuario: 'admin' },
        contraparte: { nombre: maliciousCounterpart, usuario: 'counterpart' },
        contraparte_id: maliciousCounterpartId
    };
    const dom = makeDom({
        'user-filter-tipo': { value: '' },
        'user-filter-fecha-desde': { value: '' },
        'user-filter-fecha-hasta': { value: '' },
        'user-filter-texto': { value: '' },
        'user-transacciones-cards': {},
        'user-historial-vacio': { className: 'hidden' }
    });
    const calls = [];
    const query = {
        select() { return this; },
        eq() { return this; },
        order() { return Promise.resolve({ data: [transaction], error: null }); }
    };
    const window = {
        __xssExecuted: false,
        supabaseClient: { from: () => query },
        refrescarFavoritosIdsCache() { window.favoritosIdsCache = new Set(); },
        showToast() {},
        toggleFavorito(id, name, button) {
            calls.push(['favorite', id, name, button.tagName]);
        },
        compartirComprobante(value) {
            calls.push(['receipt', value.id]);
        }
    };
    const sandbox = {
        window,
        document: dom.document,
        console,
        ultimoHistorialFiltrado: []
    };

    loadClassicCompatibleModule(historySource, sandbox, 'historial.js');
    await window.loadUserHistorial('worker-1');

    const cards = dom.nodes.get('user-transacciones-cards');
    assert.equal(cards.children.length, 1, 'one transaction card should be rendered');
    const card = cards.children[0];
    const motivo = findAll(card, node => node.className.split(/\s+/).includes('tx-card-motivo'))[0];
    assert.equal(motivo.textContent, '📝 ' + maliciousReason,
        'transaction reasons must be rendered as literal text');

    const adminDetails = findAll(card, node => textTree(node).includes(maliciousAdmin));
    assert.ok(adminDetails.length > 0, 'administrator identity must remain visible as literal text');

    const favoriteButton = findAll(card, node => node.className.split(/\s+/).includes('tx-card-favorito-btn'))[0];
    const receiptButton = findAll(card, node => node.className.split(/\s+/).includes('tx-card-comprobante-btn'))[0];
    assert.ok(favoriteButton, 'favorite action must remain available for transfers');
    assert.ok(receiptButton, 'receipt action must remain available');

    favoriteButton.dispatch('click');
    receiptButton.dispatch('click');
    assert.deepEqual(calls.map(call => Array.from(call)), [
        ['favorite', maliciousCounterpartId, maliciousCounterpart, 'BUTTON'],
        ['receipt', 'tx-1']
    ], 'event listeners must preserve favorite and receipt behavior without inline handlers');
    assert.equal(window.__xssExecuted, false, 'malicious transaction data must not execute');
}

async function testChatMessageRendering() {
    const maliciousSender = '<img src=x onerror="window.__xssExecuted=true">';
    const maliciousMessage = '<svg onload="window.__xssExecuted=true">hello</svg>';
    const maliciousSenderId = "sender');window.__xssExecuted=true;//";
    const dom = makeDom({});
    const calls = [];
    const window = {
        __xssExecuted: false,
        verPerfilDesdeChat(id) { calls.push(id); }
    };
    const sandbox = { window, document: dom.document, console };

    loadClassicCompatibleModule(chatDomSource, sandbox, 'chat-dom.js');
    const message = window.crearMensajeChatEl(
        maliciousSender,
        '2026-10-30T12:00:00.000Z',
        maliciousMessage,
        false,
        false,
        maliciousSenderId,
        true
    );

    const sender = findAll(message, node => node.className.split(/\s+/).includes('chat-msg-nombre'))[0];
    const body = findAll(message, node => node.className.split(/\s+/).includes('chat-msg-texto'))[0];
    assert.equal(sender.textContent, maliciousSender, 'chat sender name must render as literal text');
    assert.equal(body.textContent, maliciousMessage, 'chat message body must render as literal text');
    sender.dispatch('click');
    assert.deepEqual(calls, [maliciousSenderId], 'profile navigation must receive the exact ID through an event listener');
    assert.equal(window.__xssExecuted, false, 'malicious chat fields and identifiers must not execute');
}

assertNoHtmlInjectionSinks(usersSource, 'admin user cards');
assertNoHtmlInjectionSinks(chatDomSource, 'chat message rendering');
assertNoHtmlInjectionSinks(historySource, 'user transaction history');
await testAdminUsersRendering();
await testUserHistoryRendering();
await testChatMessageRendering();

console.log('PASS — admin user cards render names, usernames and emails as text');
console.log('PASS — unsafe avatar protocols are rejected in favor of an HTTPS fallback');
console.log('PASS — user management actions remain wired through DOM event listeners');
console.log('PASS — transaction reasons and administrator identities render as text');
console.log('PASS — favorite and receipt actions remain wired without inline handlers');
console.log('PASS — malicious profile and transaction payloads do not execute in the DOM harness');
console.log('PASS — chat sender and message payloads render as text and profile navigation is preserved');
