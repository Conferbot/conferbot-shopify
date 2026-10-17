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
const { escapeHtml, renderAdminPage } = require('../src/adminPage');
const { verifySessionToken, bearerToken } = require('../src/session');

const DEMO_ID = '691c970890527a0468f9b2c9';
const SECRET = 'shhh-test-secret';
const API_KEY = 'test-client-id';
const ROOT = path.join(__dirname, '..');

/** Builds an App Bridge style session token (HS256 JWT). */
function sessionToken(claims = {}, { secret = SECRET, alg = 'HS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://test-store.myshopify.com/admin',
    dest: 'https://test-store.myshopify.com',
    aud: API_KEY,
    sub: '42',
    exp: now + 60,
    nbf: now - 1,
    iat: now - 1,
    jti: crypto.randomUUID(),
    sid: 'session-1',
    ...claims,
  };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${enc({ alg, typ: 'JWT' })}.${enc(payload)}`;
  const sig = crypto.createHmac('sha256', secret).update(head).digest('base64url');
  return `${head}.${sig}`;
}
const verify = (token) => verifySessionToken(token, { apiKey: API_KEY, apiSecret: SECRET });

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

// ---- session tokens (App Bridge) ----------------------------------------------

test('session token: a valid token yields its shop', () => {
  const s = verify(sessionToken());
  assert.ok(s);
  assert.strictEqual(s.shop, 'test-store.myshopify.com');
});

test('session token: expired, not yet valid, or for another app is refused', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.strictEqual(verify(sessionToken({ exp: now - 30 })), null);
  assert.strictEqual(verify(sessionToken({ nbf: now + 60 })), null);
  assert.strictEqual(verify(sessionToken({ aud: 'some-other-app' })), null);
  assert.strictEqual(verify(sessionToken({ exp: undefined })), null);
});

test('session token: wrong secret, alg none, or a tampered payload is refused', () => {
  assert.strictEqual(verify(sessionToken({}, { secret: 'not-the-secret' })), null);
  const none = sessionToken({}, { alg: 'none' });
  assert.strictEqual(verify(none), null);
  const [h, , sig] = sessionToken().split('.');
  const evil = Buffer.from(JSON.stringify({ dest: 'https://victim.myshopify.com' })).toString('base64url');
  assert.strictEqual(verify(`${h}.${evil}.${sig}`), null);
  assert.strictEqual(verify('not.a.jwt'), null);
  assert.strictEqual(verify(''), null);
  assert.strictEqual(verifySessionToken(sessionToken(), { apiKey: API_KEY, apiSecret: '' }), null);
});

test('session token: iss and dest must be the same myshopify shop', () => {
  assert.strictEqual(verify(sessionToken({ iss: 'https://other.myshopify.com/admin' })), null);
  assert.strictEqual(verify(sessionToken({ dest: 'https://evil.com', iss: 'https://evil.com/admin' })), null);
});

test('bearerToken reads the Authorization header', () => {
  assert.strictEqual(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.strictEqual(bearerToken('bearer x'), 'x');
  assert.strictEqual(bearerToken('Basic abc'), '');
  assert.strictEqual(bearerToken(undefined), '');
});

// ---- metafields + theme editor link ----------------------------------------------

test('settingsMetafields: the four app-data metafields the app embed reads', () => {
  const owner = 'gid://shopify/AppInstallation/1';
  const fields = shopify.settingsMetafields(owner, {
    botId: DEMO_ID, enabled: true, embedType: 'fullpage_chat', scriptUrl: 'https://cdn.conferbot.com/dist/v1/widget.min.js',
  });
  assert.deepStrictEqual(fields.map((f) => [f.key, f.type, f.value]), [
    ['bot_id', 'single_line_text_field', DEMO_ID],
    ['enabled', 'boolean', 'true'],
    ['embed_type', 'single_line_text_field', 'live_chat'],
    ['script_url', 'url', 'https://cdn.conferbot.com/dist/v1/widget.min.js'],
  ]);
  for (const f of fields) {
    assert.strictEqual(f.ownerId, owner);
    assert.strictEqual(f.namespace, 'conferbot');
  }
});

test('themeEditorEmbedUrl deep-links to App embeds with this app activated', () => {
  const u = new URL(shopify.themeEditorEmbedUrl('test-store.myshopify.com', 'key123', 'conferbot-embed'));
  assert.strictEqual(u.origin, 'https://test-store.myshopify.com');
  assert.strictEqual(u.pathname, '/admin/themes/current/editor');
  assert.strictEqual(u.searchParams.get('context'), 'apps');
  assert.strictEqual(u.searchParams.get('activateAppId'), 'key123/conferbot-embed');
});

test('webhook HMAC: base64 HMAC of the raw body only', () => {
  const body = Buffer.from('{"id":1}');
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  assert.ok(shopify.verifyWebhookHmac(body, good, SECRET));
  assert.ok(!shopify.verifyWebhookHmac(Buffer.from('{"id":2}'), good, SECRET));
  assert.ok(!shopify.verifyWebhookHmac(body, good, ''));
  assert.ok(!shopify.verifyWebhookHmac('{"id":1}', good, SECRET));
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

test('settings page loads App Bridge first and carries no shop data', () => {
  const html = renderAdminPage({ apiKey: 'key"123', demoBotId: DEMO_ID });
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.ok(head.includes('<meta name="shopify-api-key" content="key&quot;123">'));
  const firstScript = head.match(/<script[^>]*>/)[0];
  assert.strictEqual(firstScript, '<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js">');
  assert.ok(html.includes('shopify.idToken()'));
  assert.ok(html.includes('App embeds'));
  assert.ok(html.includes('id="cb-embed-link"'));
});

// ---- Shopify CLI layout ----------------------------------------------------------

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('app embed block injects the same loader as /script.js', () => {
  const liquid = read('extensions/conferbot-embed/blocks/conferbot-embed.liquid');
  const schema = JSON.parse(liquid.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  assert.strictEqual(schema.target, 'body');
  assert.ok(schema.name.length < 25);
  for (const key of ['bot_id', 'enabled', 'embed_type', 'script_url']) {
    assert.ok(liquid.includes(`app.metafields.conferbot.${key}.value`), key);
  }
  assert.ok(liquid.includes("'https://cdn.conferbot.com/dist/v1/widget.min.js'"));
  // The loader body (everything after the inlined cfg) must match the served one line for line.
  const served = buildLoaderScript({ botId: DEMO_ID, enabled: true }, 's.myshopify.com', CFG);
  const body = (js) => js.slice(js.indexOf("  if (document.getElementById('conferbot-js'))"), js.indexOf('})();'));
  assert.strictEqual(body(liquid), body(served));
});

test('shopify.app.toml: placeholders only, 2026-07 webhooks, compliance topics', () => {
  const toml = read('shopify.app.toml');
  assert.match(toml, /^client_id = "YOUR_SHOPIFY_CLIENT_ID"$/m);
  assert.match(toml, /^application_url = "https:\/\/your-app\.example\.com\/app"$/m);
  assert.match(toml, /^embedded = true$/m);
  assert.match(toml, /^api_version = "2026-07"$/m);
  assert.ok(!/secret\s*=/.test(toml));
  assert.ok(!/script_tags/.test(toml));
  for (const topic of ['customers/data_request', 'customers/redact', 'shop/redact']) {
    assert.ok(toml.includes(`compliance_topics = [ "${topic}" ]`), topic);
    assert.ok(toml.includes(`uri = "/webhooks/${topic}"`), topic);
  }
  assert.ok(toml.includes('topics = [ "app/uninstalled" ]'));
  const ext = read('extensions/conferbot-embed/shopify.extension.toml');
  assert.match(ext, /^type = "theme"$/m);
});
