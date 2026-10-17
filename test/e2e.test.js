'use strict';

/**
 * End-to-end test: a mock Shopify admin (token exchange + GraphQL Admin API)
 * plus the real app. No real store is ever contacted. Exercises the merchant
 * journey:
 *
 *   Shopify-managed install -> settings page (App Bridge) -> session token
 *   exchanged for an offline token -> save writes the app-data metafields the
 *   app embed reads -> 0.1.0 ScriptTag cleanup -> webhooks.
 *
 * The final browser stage runs only when RUN_BROWSER_E2E=1 (needs Chrome
 * and network access to cdn.conferbot.com).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const createApp = require('../src/server');

const SHOP = 'test-store.myshopify.com';
const OTHER = 'other-store.myshopify.com';
const LEGACY = 'legacy-store.myshopify.com';
const API_KEY = 'test-api-key';
const API_SECRET = 'test-api-secret';
const API_VERSION = '2026-07';
const DEMO_ID = '691c970890527a0468f9b2c9';
const WIDGET_URL = 'https://cdn.conferbot.com/dist/v1/widget.min.js';

let mockShopify;
let appServer;
let appUrl;
let store;

const mock = {
  tokenRequests: [],   // bodies POSTed to /admin/oauth/access_token
  graphql: [],         // { shop, token, query, variables, version }
  metafields: {},      // shop -> { key: { type, value, ownerId } }
  scriptTags: {},      // shop -> [{ id, src }]
  failMetafields: false,
  failScriptTags: false,
  expiresIn: 3600,
  nextId: 1,
};

function sessionToken(shop = SHOP, claims = {}, secret = API_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: API_KEY, sub: '42',
    exp: now + 60, nbf: now - 1, iat: now - 1, jti: crypto.randomUUID(), sid: 's', ...claims,
  };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
  return `${head}.${crypto.createHmac('sha256', secret).update(head).digest('base64url')}`;
}

const api = (method, { shop = SHOP, token = sessionToken(shop), body } = {}) => fetch(`${appUrl}/api/settings`, {
  method,
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  },
  body: body ? JSON.stringify(body) : undefined,
});

function handleGraphql(shop, token, { query, variables }, res) {
  mock.graphql.push({ shop, token, query, variables });
  const send = (data) => res.end(JSON.stringify({ data }));
  if (query.includes('currentAppInstallation')) {
    return send({ currentAppInstallation: { id: `gid://shopify/AppInstallation/${shop.length}` } });
  }
  if (query.includes('metafieldsSet')) {
    if (mock.failMetafields) {
      return send({ metafieldsSet: { metafields: [], userErrors: [{ field: ['value'], message: 'nope', code: 'INVALID' }] } });
    }
    mock.metafields[shop] = mock.metafields[shop] || {};
    for (const m of variables.metafields) {
      mock.metafields[shop][`${m.namespace}.${m.key}`] = { type: m.type, value: m.value, ownerId: m.ownerId };
    }
    return send({ metafieldsSet: { metafields: variables.metafields.map(({ key, namespace }) => ({ key, namespace })), userErrors: [] } });
  }
  if (query.includes('scriptTagDelete')) {
    mock.scriptTags[shop] = (mock.scriptTags[shop] || []).filter((t) => t.id !== variables.id);
    return send({ scriptTagDelete: { deletedScriptTagId: variables.id, userErrors: [] } });
  }
  if (query.includes('scriptTags')) {
    if (mock.failScriptTags) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ errors: 'access denied' }));
    }
    return send({ scriptTags: { nodes: mock.scriptTags[shop] || [], pageInfo: { hasNextPage: false, endCursor: null } } });
  }
  res.statusCode = 400;
  res.end(JSON.stringify({ errors: [{ message: 'unknown operation' }] }));
}

before(async () => {
  mockShopify = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const [, shop, ...rest] = url.pathname.split('/');
      const pathname = `/${rest.join('/')}`;
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && pathname === '/admin/oauth/access_token') {
        const parsed = JSON.parse(body);
        mock.tokenRequests.push({ shop, ...parsed });
        return res.end(JSON.stringify({
          access_token: `offline-${shop}-${mock.tokenRequests.length}`,
          expires_in: mock.expiresIn,
          refresh_token: 'refresh-x',
          refresh_token_expires_in: 7776000,
          scope: '',
        }));
      }
      if (req.method === 'POST' && pathname === `/admin/api/${API_VERSION}/graphql.json`) {
        return handleGraphql(shop, req.headers['x-shopify-access-token'], JSON.parse(body), res);
      }
      res.statusCode = 404;
      res.end('{"errors":"not found"}');
    });
  });
  await new Promise((r) => mockShopify.listen(0, r));
  const mockPort = mockShopify.address().port;

  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbshop-e2e-')), 'shops.json');
  const cfg = {
    port: 0,
    appUrl: '',
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    apiVersion: API_VERSION,
    adminBase: `http://localhost:${mockPort}/{shop}`,
    embedHandle: 'conferbot-embed',
    widgetScriptUrl: WIDGET_URL,
    demoBotId: DEMO_ID,
    dataFile,
  };
  const created = createApp(cfg);
  store = created.store;
  appServer = http.createServer(created.app);
  await new Promise((r) => appServer.listen(0, r));
  appUrl = `http://localhost:${appServer.address().port}`;
  cfg.appUrl = appUrl;
});

after(async () => {
  await new Promise((r) => appServer.close(r));
  await new Promise((r) => mockShopify.close(r));
});

// NOTE: node:test runs tests in this file sequentially; the steps below are
// one continuous merchant journey and share state on purpose.

test('step 1: the embedded settings page loads App Bridge with the client ID', async () => {
  const res = await fetch(`${appUrl}/app?shop=${SHOP}&host=abc&embedded=1`);
  const html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.ok(html.includes(`<meta name="shopify-api-key" content="${API_KEY}">`));
  assert.ok(html.includes('https://cdn.shopify.com/shopifycloud/app-bridge.js'));
  assert.ok(html.includes('Paste your Chatbot ID'));
  assert.ok(html.includes(`data-demo-id="${DEMO_ID}"`));
  assert.ok(!html.includes('name="token"'), 'no home-grown form token any more');
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
});

test('step 1b: settings page may only be framed by the shop admin', async () => {
  const res = await fetch(`${appUrl}/app?shop=${SHOP}`);
  assert.strictEqual(res.headers.get('content-security-policy'), `frame-ancestors https://${SHOP} https://admin.shopify.com;`);
  const bad = await fetch(`${appUrl}/app?shop=evil.com`);
  assert.strictEqual(bad.headers.get('content-security-policy'), "frame-ancestors 'none';");
});

test('step 2: the settings API refuses calls without a valid session token', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const token of [
    '',
    'garbage',
    sessionToken(SHOP, {}, 'wrong-secret'),
    sessionToken(SHOP, { exp: now - 120 }),
    sessionToken(SHOP, { aud: 'another-app' }),
    sessionToken(SHOP, { iss: `https://${OTHER}/admin` }),
  ]) {
    const res = await api('GET', { token });
    assert.strictEqual(res.status, 401, token);
    assert.strictEqual(res.headers.get('x-shopify-retry-invalid-session-request'), '1');
  }
  const post = await api('POST', { token: '', body: { botId: DEMO_ID, enabled: '1' } });
  assert.strictEqual(post.status, 401);
  assert.strictEqual(mock.tokenRequests.length, 0, 'nothing reaches Shopify without a valid token');
  assert.strictEqual(store.get(SHOP), null);
});

test('step 3: first authenticated call exchanges the session token for an expiring offline token', async () => {
  const idToken = sessionToken();
  const res = await api('GET', { token: idToken });
  assert.strictEqual(res.status, 200);
  const s = await res.json();
  assert.deepStrictEqual(s, {
    shop: SHOP,
    botId: '',
    enabled: false,
    embedType: 'live_chat',
    themeEditorUrl: `https://${SHOP}/admin/themes/current/editor?context=apps&activateAppId=${API_KEY}%2Fconferbot-embed`,
  });
  assert.strictEqual(mock.tokenRequests.length, 1);
  assert.deepStrictEqual(mock.tokenRequests[0], {
    shop: SHOP,
    client_id: API_KEY,
    client_secret: API_SECRET,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    expiring: '1',
  });
  const record = store.get(SHOP);
  assert.strictEqual(record.accessToken, `offline-${SHOP}-1`);
  assert.ok(record.accessTokenExpiresAt > Date.now() + 3500 * 1000);
});

test('step 3b: the offline token is reused while it is valid', async () => {
  assert.strictEqual((await api('GET')).status, 200);
  assert.strictEqual(mock.tokenRequests.length, 1);
});

test('step 4: loader endpoint is a no-op before configuration', async () => {
  const res = await fetch(`${appUrl}/script.js?shop=${SHOP}`);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(await res.text(), /not configured/);
});

test('step 5: saving a pasted snippet writes the app-data metafields via GraphQL', async () => {
  const res = await api('POST', {
    body: { botId: `window.ConferbotWidget("${DEMO_ID}", "live_chat")`, enabled: '1', embedType: 'popup_chat' },
  });
  assert.strictEqual(res.status, 200);
  const s = await res.json();
  assert.strictEqual(s.saved, true);
  assert.strictEqual(s.botId, DEMO_ID);
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.embedType, 'popup_chat');

  const owner = `gid://shopify/AppInstallation/${SHOP.length}`;
  assert.deepStrictEqual(mock.metafields[SHOP], {
    'conferbot.bot_id': { type: 'single_line_text_field', value: DEMO_ID, ownerId: owner },
    'conferbot.enabled': { type: 'boolean', value: 'true', ownerId: owner },
    'conferbot.embed_type': { type: 'single_line_text_field', value: 'popup_chat', ownerId: owner },
    'conferbot.script_url': { type: 'url', value: WIDGET_URL, ownerId: owner },
  });
  const calls = mock.graphql.filter((c) => c.shop === SHOP);
  assert.ok(calls.every((c) => c.token === `offline-${SHOP}-1`), 'GraphQL uses the offline token');
  assert.ok(!calls.some((c) => /scriptTag/.test(c.query)), 'a fresh install never touches ScriptTags');
  assert.strictEqual(store.get(SHOP).appInstallationId, owner);
});

test('step 5b: later saves reuse the installation id; an invalid ID cannot switch the chat on', async () => {
  const before = mock.graphql.length;
  const res = await api('POST', { body: { botId: 'not an id', enabled: '1', embedType: 'live_chat' } });
  assert.strictEqual(res.status, 200);
  const s = await res.json();
  assert.strictEqual(s.botId, '');
  assert.strictEqual(s.enabled, false);
  const calls = mock.graphql.slice(before);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].query, /metafieldsSet/);
  assert.strictEqual(mock.metafields[SHOP]['conferbot.enabled'].value, 'false');
});

test('step 5c: a metafield write error is reported and the stored settings stay as they were', async () => {
  mock.failMetafields = true;
  try {
    const res = await api('POST', { body: { botId: DEMO_ID, enabled: '1' } });
    assert.strictEqual(res.status, 502);
    assert.match((await res.json()).error, /nope/);
    assert.strictEqual(store.get(SHOP).enabled, false);
  } finally {
    mock.failMetafields = false;
  }
  const ok = await api('POST', { body: { botId: DEMO_ID, enabled: '1', embedType: 'live_chat' } });
  assert.strictEqual(ok.status, 200);
});

test('step 5d: a token for one shop only ever reads and writes that shop', async () => {
  const res = await api('GET', { shop: OTHER });
  const s = await res.json();
  assert.strictEqual(s.shop, OTHER);
  assert.strictEqual(s.botId, '');
  assert.strictEqual(store.get(SHOP).botId, DEMO_ID);
});

test('step 5e: an expired offline token is exchanged again', async () => {
  store.upsert(SHOP, { accessTokenExpiresAt: Date.now() + 1000 });
  const count = mock.tokenRequests.length;
  assert.strictEqual((await api('GET')).status, 200);
  assert.strictEqual(mock.tokenRequests.length, count + 1);
  assert.strictEqual(store.get(SHOP).accessToken, `offline-${SHOP}-${count + 1}`);
});

test('step 6: legacy /script.js loader still serves 0.1.0 ScriptTags the same widget', async () => {
  const js = await (await fetch(`${appUrl}/script.js?shop=${SHOP}`)).text();
  assert.ok(js.includes(DEMO_ID));
  assert.ok(js.includes('window.ConferbotWidget(cfg.botId'));
  assert.ok(js.includes(WIDGET_URL));
});

test('step 6b: unknown shops get a safe no-op, invalid shops never echo input', async () => {
  const other = await fetch(`${appUrl}/script.js?shop=nobody.myshopify.com`);
  assert.match(await other.text(), /not configured/);
  const evil = await fetch(`${appUrl}/script.js?shop=${encodeURIComponent('"></script><script>alert(1)</script>')}`);
  const js = await evil.text();
  assert.match(js, /invalid shop/);
  assert.ok(!js.includes('alert(1)'));
});

// ---- 0.1.0 installs: ScriptTag cleanup ------------------------------------------

test('legacy: the old ScriptTag is deleted on the first save after upgrading', async () => {
  // What 0.1.0 left behind: a non-expiring OAuth token and the ScriptTag id.
  store.upsert(LEGACY, { accessToken: 'legacy-oauth-token', scriptTagId: 77, botId: DEMO_ID, enabled: true });
  mock.scriptTags[LEGACY] = [
    { id: 'gid://shopify/ScriptTag/77', src: `https://old-app.example.com/script.js?shop=${LEGACY}` },
    { id: 'gid://shopify/ScriptTag/78', src: 'https://old-app.example.com/other.js' },
  ];

  assert.strictEqual((await api('GET', { shop: LEGACY })).status, 200);
  const record = store.get(LEGACY);
  assert.strictEqual(record.legacyAccessToken, 'legacy-oauth-token');
  assert.match(record.accessToken, /^offline-/);

  const res = await api('POST', { shop: LEGACY, body: { botId: DEMO_ID, enabled: '1' } });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(mock.scriptTags[LEGACY].map((t) => t.id), ['gid://shopify/ScriptTag/78']);
  const cleanup = mock.graphql.filter((c) => c.shop === LEGACY && /scriptTag/i.test(c.query));
  assert.ok(cleanup.length >= 2);
  assert.ok(cleanup.every((c) => c.token === 'legacy-oauth-token'), 'cleanup uses the token that has write_script_tags');
  const after = store.get(LEGACY);
  assert.strictEqual(after.legacyAccessToken, undefined);
  assert.strictEqual(after.scriptTagId, undefined);
  assert.strictEqual(mock.metafields[LEGACY]['conferbot.enabled'].value, 'true');
});

test('legacy: a failed cleanup never fails the save and is retried next time', async () => {
  store.upsert(LEGACY, { scriptTagId: 79, legacyAccessToken: 'legacy-oauth-token' });
  mock.failScriptTags = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const res = await api('POST', { shop: LEGACY, body: { botId: DEMO_ID, enabled: '1' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(store.get(LEGACY).scriptTagId, 79);
  } finally {
    console.warn = warn;
    mock.failScriptTags = false;
  }
  assert.strictEqual((await api('POST', { shop: LEGACY, body: { botId: DEMO_ID, enabled: '1' } })).status, 200);
  assert.strictEqual(store.get(LEGACY).scriptTagId, undefined);
});

test('step 7: real browser - widget mounts on a storefront page', { skip: process.env.RUN_BROWSER_E2E !== '1' }, async () => {
  const puppeteer = require('puppeteer');

  // fake storefront that includes the loader, like the legacy ScriptTag did
  const storefront = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><head>
      <script>window.Shopify = { shop: '${SHOP}', currency: { active: 'USD' } };</script>
      <script src="${appUrl}/script.js?shop=${SHOP}"></script>
      </head><body><h1>Mock Shopify storefront</h1></body></html>`);
  });
  await new Promise((r) => storefront.listen(0, r));
  const sfPort = storefront.address().port;

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${sfPort}/`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('conferbot-widget', { timeout: 30000 });
    const mounted = await page.evaluate(() => ({
      widgetTag: !!document.querySelector('conferbot-widget'),
      globalFn: typeof window.ConferbotWidget,
    }));
    assert.ok(mounted.widgetTag, 'conferbot-widget element should mount');
    assert.strictEqual(mounted.globalFn, 'function');
  } finally {
    await browser.close();
    await new Promise((r) => storefront.close(r));
  }
});

// ---- webhooks (run last: they remove shops) --------------------------------------

function webhook(topic, payload, { shop = SHOP, secret = API_SECRET, hmac } = {}) {
  const body = JSON.stringify(payload);
  const sig = hmac !== undefined ? hmac : crypto.createHmac('sha256', secret).update(body).digest('base64');
  return fetch(`${appUrl}/webhooks/${topic}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Shop-Domain': shop,
      'X-Shopify-Topic': topic,
      ...(sig ? { 'X-Shopify-Hmac-Sha256': sig } : {}),
    },
    body,
  });
}

test('webhooks: a bad or missing HMAC is refused and nothing changes', async () => {
  assert.strictEqual((await webhook('app/uninstalled', { id: 1 }, { secret: 'wrong' })).status, 401);
  assert.strictEqual((await webhook('shop/redact', { shop_domain: SHOP }, { hmac: 'AAAA' })).status, 401);
  assert.strictEqual((await webhook('customers/redact', { shop_domain: SHOP }, { hmac: '' })).status, 401);
  assert.strictEqual((await webhook('orders/create', {})).status, 404);
  assert.ok(store.get(SHOP));
});

test('webhooks: customers/data_request and customers/redact acknowledge (no customer data kept)', async () => {
  const before = JSON.stringify(store.get(SHOP));
  assert.strictEqual((await webhook('customers/data_request', { shop_domain: SHOP, customer: { id: 1 }, orders_requested: [] })).status, 200);
  assert.strictEqual((await webhook('customers/redact', { shop_domain: SHOP, customer: { id: 1 }, orders_to_redact: [] })).status, 200);
  assert.strictEqual(JSON.stringify(store.get(SHOP)), before, 'shop settings are untouched');
});

test('webhooks: shop/redact erases the shop record', async () => {
  assert.ok(store.get(OTHER));
  assert.strictEqual((await webhook('shop/redact', { shop_id: 2, shop_domain: OTHER }, { shop: OTHER })).status, 200);
  assert.strictEqual(store.get(OTHER), null);
});

test('webhooks: app/uninstalled drops the shop record and its tokens', async () => {
  assert.strictEqual((await webhook('app/uninstalled', { domain: SHOP })).status, 200);
  assert.strictEqual(store.get(SHOP), null);
  assert.match(await (await fetch(`${appUrl}/script.js?shop=${SHOP}`)).text(), /not configured/);
  const persisted = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  assert.ok(!(SHOP in persisted), 'gone from disk too');
  // shop/redact (48h after uninstall) is then a harmless no-op
  assert.strictEqual((await webhook('shop/redact', { shop_domain: SHOP })).status, 200);
  // A reinstall starts clean with a new token exchange.
  const count = mock.tokenRequests.length;
  const s = await (await api('GET')).json();
  assert.strictEqual(s.botId, '');
  assert.strictEqual(mock.tokenRequests.length, count + 1);
});
