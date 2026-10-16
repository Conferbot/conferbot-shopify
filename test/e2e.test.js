'use strict';

/**
 * End-to-end test: a mock Shopify admin (OAuth token endpoint + ScriptTag
 * REST API) plus the real app. Exercises the full merchant journey:
 *
 *   install (OAuth + HMAC + ScriptTag) -> configure bot in the settings
 *   page -> storefront loads /script.js -> loader boots the real widget.
 *
 * The final browser stage runs only when RUN_BROWSER_E2E=1 (needs Chrome
 * and network access to cdn.conferbot.com); CI without Chrome still covers
 * everything up to the served loader script.
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
const API_KEY = 'test-api-key';
const API_SECRET = 'test-api-secret';
const DEMO_ID = '691c970890527a0468f9b2c9';

let mockShopify;       // fake Shopify admin server
let mockPort;
let appServer;
let appPort;
let appUrl;
const mockState = { tokenRequests: [], scriptTags: [], webhooks: [], nextId: 1001 };

function sign(query, secret) {
  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

before(async () => {
  // --- mock Shopify admin ---
  mockShopify = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && url.pathname.endsWith('/admin/oauth/access_token')) {
        mockState.tokenRequests.push(JSON.parse(body));
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ access_token: 'mock-token-42', scope: 'write_script_tags' }));
      }
      if (url.pathname.includes('/script_tags.json')) {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ script_tags: mockState.scriptTags }));
        }
        if (req.method === 'POST') {
          const tag = JSON.parse(body).script_tag;
          tag.id = mockState.nextId++;
          mockState.scriptTags.push(tag);
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ script_tag: tag }));
        }
      }
      if (url.pathname.includes('/webhooks.json')) {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
          return res.end(JSON.stringify({ webhooks: mockState.webhooks }));
        }
        if (req.method === 'POST') {
          const hook = JSON.parse(body).webhook;
          hook.id = mockState.nextId++;
          mockState.webhooks.push(hook);
          res.statusCode = 201;
          return res.end(JSON.stringify({ webhook: hook }));
        }
      }
      res.statusCode = 404;
      res.end('not found');
    });
  });
  await new Promise((r) => mockShopify.listen(0, r));
  mockPort = mockShopify.address().port;

  // --- the real app, pointed at the mock ---
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbshop-e2e-')), 'shops.json');
  // handlers read cfg at request time, so appUrl can be filled in after listen
  const cfg = {
    port: 0,
    appUrl: '',
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    scopes: 'write_script_tags',
    apiVersion: '2024-01',
    adminBase: `http://localhost:${mockPort}/{shop}`,
    widgetScriptUrl: 'https://cdn.conferbot.com/dist/v1/widget.min.js',
    demoBotId: DEMO_ID,
    dataFile,
  };
  const { app } = createApp(cfg);
  appServer = http.createServer(app);
  await new Promise((r) => appServer.listen(0, r));
  appPort = appServer.address().port;
  appUrl = `http://localhost:${appPort}`;
  cfg.appUrl = appUrl;
});

after(async () => {
  await new Promise((r) => appServer.close(r));
  await new Promise((r) => mockShopify.close(r));
});

// NOTE: node:test runs tests in this file sequentially; the steps below are
// one continuous merchant journey and share state on purpose.

let authState;

test('step 1: /auth redirects to the shop authorize page with CSRF state', async () => {
  const res = await fetch(`${appUrl}/auth?shop=${SHOP}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.strictEqual(loc.pathname, `/${SHOP}/admin/oauth/authorize`);
  assert.strictEqual(loc.searchParams.get('client_id'), API_KEY);
  assert.strictEqual(loc.searchParams.get('scope'), 'write_script_tags');
  authState = loc.searchParams.get('state');
  assert.ok(authState && authState.length >= 32);
});

test('step 1b: /auth rejects non-myshopify domains', async () => {
  const res = await fetch(`${appUrl}/auth?shop=evil.com`, { redirect: 'manual' });
  assert.strictEqual(res.status, 400);
});

test('step 2: signed OAuth callback exchanges the code and installs the ScriptTag', async () => {
  const query = { shop: SHOP, code: 'grant-code-7', state: authState, timestamp: '1700000000' };
  query.hmac = sign(query, API_SECRET);
  const qs = new URLSearchParams(query).toString();

  const res = await fetch(`${appUrl}/auth/callback?${qs}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.get('location').startsWith('/app?shop='));

  // token exchange hit the mock with the right credentials
  assert.deepStrictEqual(mockState.tokenRequests[0], {
    client_id: API_KEY, client_secret: API_SECRET, code: 'grant-code-7',
  });
  // exactly one ScriptTag pointing at our loader
  assert.strictEqual(mockState.scriptTags.length, 1);
  assert.strictEqual(mockState.scriptTags[0].event, 'onload');
  assert.strictEqual(mockState.scriptTags[0].src, `${appUrl}/script.js?shop=${encodeURIComponent(SHOP)}`);
  // and the uninstall webhook, so the shop record goes when the app does
  assert.strictEqual(mockState.webhooks.length, 1);
  assert.strictEqual(mockState.webhooks[0].topic, 'app/uninstalled');
  assert.strictEqual(mockState.webhooks[0].address, `${appUrl}/webhooks/app/uninstalled`);
});

test('step 2b: callback with a bad hmac is rejected', async () => {
  const auth = await fetch(`${appUrl}/auth?shop=${SHOP}`, { redirect: 'manual' });
  const state = new URL(auth.headers.get('location')).searchParams.get('state');
  const query = { shop: SHOP, code: 'x', state, timestamp: '1700000001', hmac: 'f'.repeat(64) };
  const res = await fetch(`${appUrl}/auth/callback?${new URLSearchParams(query)}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 403);
});

test('step 2c: callback with an unknown state nonce is rejected', async () => {
  const query = { shop: SHOP, code: 'x', state: 'forged-state', timestamp: '1700000002' };
  query.hmac = sign(query, API_SECRET);
  const res = await fetch(`${appUrl}/auth/callback?${new URLSearchParams(query)}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 403);
});

test('step 2d: reinstalling does not duplicate the ScriptTag', async () => {
  const auth = await fetch(`${appUrl}/auth?shop=${SHOP}`, { redirect: 'manual' });
  const state = new URL(auth.headers.get('location')).searchParams.get('state');
  const query = { shop: SHOP, code: 'grant-code-8', state, timestamp: '1700000003' };
  query.hmac = sign(query, API_SECRET);
  const res = await fetch(`${appUrl}/auth/callback?${new URLSearchParams(query)}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(mockState.scriptTags.length, 1);
  assert.strictEqual(mockState.webhooks.length, 1);
});

let formToken; // the settings page's signed form token

function adminLaunch(shop = SHOP) {
  const query = { shop, timestamp: String(Math.floor(Date.now() / 1000)) };
  query.hmac = sign(query, API_SECRET);
  return new URLSearchParams(query).toString();
}

test('step 3: settings page renders with the demo bot offer', async () => {
  const res = await fetch(`${appUrl}/app?${adminLaunch()}`);
  const html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.ok(html.includes('Paste your Chatbot ID'));
  assert.ok(html.includes(`data-demo-id="${DEMO_ID}"`));
  formToken = html.match(/name="token" value="([^"]+)"/)[1];
  assert.ok(formToken.length > 40);
});

test('step 3b: settings page refuses anyone but the shop admin', async () => {
  // A bare ?shop= (the old hole), a stale or forged launch, and a shop that never installed.
  assert.strictEqual((await fetch(`${appUrl}/app?shop=${SHOP}`)).status, 401);
  const stale = { shop: SHOP, timestamp: '1700000000' };
  stale.hmac = sign(stale, API_SECRET);
  assert.strictEqual((await fetch(`${appUrl}/app?${new URLSearchParams(stale)}`)).status, 401);
  const forged = { shop: SHOP, timestamp: String(Math.floor(Date.now() / 1000)), hmac: 'a'.repeat(64) };
  assert.strictEqual((await fetch(`${appUrl}/app?${new URLSearchParams(forged)}`)).status, 401);
  assert.strictEqual((await fetch(`${appUrl}/app?${adminLaunch('other.myshopify.com')}`)).status, 401);
});

test('step 3c: saving without the page token, or with another shop\'s, is refused', async () => {
  const post = (fields) => fetch(`${appUrl}/app/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ shop: SHOP, botId: 'aaaaaaaaaaaaaaaaaaaaaaaa', enabled: '1', ...fields }),
    redirect: 'manual',
  });
  assert.strictEqual((await post({})).status, 401);
  assert.strictEqual((await post({ token: 'x.y' })).status, 401);
  const session = require('../src/session');
  assert.strictEqual((await post({ token: session.issueToken('other.myshopify.com', API_SECRET) })).status, 401);
  assert.strictEqual((await post({ token: session.issueToken(SHOP, 'wrong-secret') })).status, 401);
});

test('step 4: loader is a no-op before configuration', async () => {
  const res = await fetch(`${appUrl}/script.js?shop=${SHOP}`);
  const js = await res.text();
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(js, /not configured/);
});

test('step 5: saving a pasted snippet extracts the bot id and enables the chat', async () => {
  const body = new URLSearchParams({
    shop: SHOP,
    botId: `window.ConferbotWidget("${DEMO_ID}", "live_chat")`, // full snippet paste
    enabled: '1',
    embedType: 'live_chat',
    token: formToken,
  });
  const res = await fetch(`${appUrl}/app/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });
  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.get('location').includes('saved=1'));
});

test('step 6: storefront loader now boots the widget with the demo bot', async () => {
  const res = await fetch(`${appUrl}/script.js?shop=${SHOP}`);
  const js = await res.text();
  assert.ok(js.includes(DEMO_ID));
  assert.ok(js.includes('window.ConferbotWidget(cfg.botId'));
  assert.ok(js.includes('cdn.conferbot.com/dist/v1/widget.min.js'));
});

test('step 6b: unknown shops get a safe no-op, invalid shops never echo input', async () => {
  const other = await fetch(`${appUrl}/script.js?shop=other.myshopify.com`);
  assert.match(await other.text(), /not configured/);
  const evil = await fetch(`${appUrl}/script.js?shop=${encodeURIComponent('"></script><script>alert(1)</script>')}`);
  const js = await evil.text();
  assert.match(js, /invalid shop/);
  assert.ok(!js.includes('alert(1)'));
});

test('step 7: real browser - widget mounts on a storefront page', { skip: process.env.RUN_BROWSER_E2E !== '1' }, async () => {
  const puppeteer = require('puppeteer');

  // fake storefront that only includes the ScriptTag src, like Shopify would
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

// ---- webhooks (run last: they remove the shop) ------------------------------

function webhook(topic, payload, { shop = SHOP, secret = API_SECRET, hmac } = {}) {
  const body = JSON.stringify(payload);
  return fetch(`${appUrl}/webhooks/${topic}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Shop-Domain': shop,
      'X-Shopify-Topic': topic,
      'X-Shopify-Hmac-Sha256': hmac || crypto.createHmac('sha256', secret).update(body).digest('base64'),
    },
    body,
  });
}

test('webhooks: a bad or missing HMAC is refused and nothing changes', async () => {
  assert.strictEqual((await webhook('app/uninstalled', { id: 1 }, { secret: 'wrong' })).status, 401);
  assert.strictEqual((await webhook('shop/redact', { shop_domain: SHOP }, { hmac: 'AAAA' })).status, 401);
  assert.strictEqual((await webhook('orders/create', {})).status, 404);
  const loader = await (await fetch(`${appUrl}/script.js?shop=${SHOP}`)).text();
  assert.ok(loader.includes(DEMO_ID));
});

test('webhooks: customers/data_request and customers/redact acknowledge (no customer data kept)', async () => {
  assert.strictEqual((await webhook('customers/data_request', { shop_domain: SHOP, customer: { id: 1 } })).status, 200);
  assert.strictEqual((await webhook('customers/redact', { shop_domain: SHOP, customer: { id: 1 } })).status, 200);
});

test('webhooks: app/uninstalled drops the shop record and its token', async () => {
  assert.strictEqual((await webhook('app/uninstalled', { domain: SHOP })).status, 200);
  assert.match(await (await fetch(`${appUrl}/script.js?shop=${SHOP}`)).text(), /not configured/);
  assert.strictEqual((await fetch(`${appUrl}/app?${adminLaunch()}`)).status, 401);
  // shop/redact (48h after uninstall) is then a harmless no-op
  assert.strictEqual((await webhook('shop/redact', { shop_domain: SHOP })).status, 200);
});
