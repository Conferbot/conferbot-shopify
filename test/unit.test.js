'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const shopify = require('../src/shopify');
const { isValidBotId, extractBotId, buildLoaderScript } = require('../src/widgetScript');
const ShopStore = require('../src/store');
const { escapeHtml } = require('../src/adminPage');

const DEMO_ID = '691c970890527a0468f9b2c9';
const SECRET = 'shhh-test-secret';

function sign(query, secret) {
  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

// ---- shop domain validation -------------------------------------------------

test('accepts real myshopify domains', () => {
  assert.ok(shopify.isValidShopDomain('test-store.myshopify.com'));
  assert.ok(shopify.isValidShopDomain('a1.myshopify.com'));
});

test('rejects lookalike and garbage domains', () => {
  assert.ok(!shopify.isValidShopDomain('evil.com'));
  assert.ok(!shopify.isValidShopDomain('test.myshopify.com.evil.com'));
  assert.ok(!shopify.isValidShopDomain('https://test.myshopify.com'));
  assert.ok(!shopify.isValidShopDomain(''));
  assert.ok(!shopify.isValidShopDomain(null));
  assert.ok(!shopify.isValidShopDomain('TEST.MYSHOPIFY.COM'));
});

// ---- OAuth HMAC ---------------------------------------------------------------

test('verifyHmac accepts a correctly signed query', () => {
  const query = { shop: 'test-store.myshopify.com', code: 'abc', state: 'n1', timestamp: '1700000000' };
  query.hmac = sign(query, SECRET);
  assert.ok(shopify.verifyHmac(query, SECRET));
});

test('verifyHmac rejects a tampered query', () => {
  const query = { shop: 'test-store.myshopify.com', code: 'abc', state: 'n1', timestamp: '1700000000' };
  query.hmac = sign(query, SECRET);
  query.code = 'evil';
  assert.ok(!shopify.verifyHmac(query, SECRET));
});

test('verifyHmac rejects wrong secret, missing hmac, and non-string hmac', () => {
  const query = { shop: 'test-store.myshopify.com', code: 'abc' };
  query.hmac = sign(query, SECRET);
  assert.ok(!shopify.verifyHmac(query, 'other-secret'));
  assert.ok(!shopify.verifyHmac({ shop: 'x.myshopify.com' }, SECRET));
  assert.ok(!shopify.verifyHmac({ shop: 'x.myshopify.com', hmac: ['a', 'b'] }, SECRET));
});

test('verifyHmac excludes hmac and signature params from the message', () => {
  const query = { shop: 'test-store.myshopify.com', code: 'abc', signature: 'legacy' };
  query.hmac = sign(query, SECRET);
  assert.ok(shopify.verifyHmac(query, SECRET));
});

// ---- authorize URL ---------------------------------------------------------

test('buildAuthorizeUrl targets the shop admin with the right params', () => {
  const url = shopify.buildAuthorizeUrl({
    shop: 'test-store.myshopify.com',
    apiKey: 'key123',
    scopes: 'write_script_tags',
    redirectUri: 'https://app.example.com/auth/callback',
    state: 'nonce9',
    adminBase: 'https://{shop}',
  });
  const u = new URL(url);
  assert.strictEqual(u.origin, 'https://test-store.myshopify.com');
  assert.strictEqual(u.pathname, '/admin/oauth/authorize');
  assert.strictEqual(u.searchParams.get('client_id'), 'key123');
  assert.strictEqual(u.searchParams.get('scope'), 'write_script_tags');
  assert.strictEqual(u.searchParams.get('state'), 'nonce9');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://app.example.com/auth/callback');
});

// ---- bot id helpers (same contract as the PrestaShop module) ---------------

test('extractBotId pulls the ID out of anything', () => {
  assert.strictEqual(extractBotId(DEMO_ID), DEMO_ID);
  assert.strictEqual(extractBotId(`  ${DEMO_ID} \n`), DEMO_ID);
  assert.strictEqual(extractBotId(`window.ConferbotWidget("${DEMO_ID}", "live_chat")`), DEMO_ID);
  assert.strictEqual(extractBotId('no id here'), '');
  assert.strictEqual(extractBotId(''), '');
  assert.strictEqual(extractBotId(null), '');
});

test('isValidBotId is strict', () => {
  assert.ok(isValidBotId(DEMO_ID));
  assert.ok(!isValidBotId(DEMO_ID.slice(0, 23)));
  assert.ok(!isValidBotId(DEMO_ID + '0'));
  assert.ok(!isValidBotId('691c970890527a0468f9b2cz'));
  assert.ok(!isValidBotId(''));
});

// ---- loader script ------------------------------------------------------------

const CFG = { widgetScriptUrl: 'https://cdn.conferbot.com/dist/v1/widget.min.js' };

test('loader is a no-op comment when unconfigured, disabled, or invalid', () => {
  for (const record of [null, {}, { botId: DEMO_ID, enabled: false }, { botId: 'nope', enabled: true }]) {
    const js = buildLoaderScript(record, 's.myshopify.com', CFG);
    assert.match(js, /not configured/);
    assert.ok(!js.includes('ConferbotWidget('));
  }
});

test('loader embeds bot id, embed type and cdn url when enabled', () => {
  const js = buildLoaderScript({ botId: DEMO_ID, enabled: true }, 'test-store.myshopify.com', CFG);
  assert.ok(js.includes(DEMO_ID));
  assert.ok(js.includes('"embedType":"live_chat"'));
  assert.ok(js.includes(CFG.widgetScriptUrl));
  assert.ok(js.includes("window.ConferbotWidget(cfg.botId"));
  assert.ok(js.includes('conferbot-js'));
});

test('loader respects popup embed type and falls back for unknown types', () => {
  const popup = buildLoaderScript({ botId: DEMO_ID, enabled: true, embedType: 'popup_chat' }, 's.myshopify.com', CFG);
  assert.ok(popup.includes('"embedType":"popup_chat"'));
  const fallback = buildLoaderScript({ botId: DEMO_ID, enabled: true, embedType: 'fullpage_chat' }, 's.myshopify.com', CFG);
  assert.ok(fallback.includes('"embedType":"live_chat"'));
});

test('loader JSON is inert inside a script context', () => {
  const js = buildLoaderScript({ botId: DEMO_ID, enabled: true }, 's.myshopify.com', {
    widgetScriptUrl: 'https://cdn.example.com/w.js?a=1&b=2</script>',
  });
  assert.ok(!js.includes('</script>'));
  assert.ok(!js.includes('&b='));
});

// ---- store ----------------------------------------------------------------------

test('store persists and reloads shops', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbshop-')), 'shops.json');
  const store = new ShopStore(file);
  store.upsert('a.myshopify.com', { botId: DEMO_ID, enabled: true });
  store.upsert('a.myshopify.com', { accessToken: 'tok' });

  const reloaded = new ShopStore(file);
  assert.deepStrictEqual(reloaded.get('a.myshopify.com'), {
    botId: DEMO_ID, enabled: true, accessToken: 'tok',
  });

  reloaded.remove('a.myshopify.com');
  assert.strictEqual(new ShopStore(file).get('a.myshopify.com'), null);
});

test('store survives a corrupt data file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbshop-')), 'shops.json');
  fs.writeFileSync(file, '{corrupt');
  const store = new ShopStore(file);
  assert.strictEqual(store.get('a.myshopify.com'), null);
});

// ---- admin page escaping -----------------------------------------------------

test('escapeHtml neutralizes markup', () => {
  assert.strictEqual(escapeHtml('<script>"x"&\'y\''), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
});
