'use strict';

const crypto = require('crypto');
const express = require('express');
const shopify = require('./shopify');
const ShopStore = require('./store');
const { buildLoaderScript, extractBotId, isValidBotId } = require('./widgetScript');
const { renderAdminPage } = require('./adminPage');
const session = require('./session');

/**
 * App factory - takes config so tests can inject a mock Shopify admin base
 * and a temp data file. Returns { app, store }.
 */
function createApp(cfg) {
  const app = express();
  const store = new ShopStore(cfg.dataFile);
  // state nonce -> { shop, expires } (single-instance OAuth CSRF guard).
  // Nonces expire after 10 minutes and the map is capped, so repeated
  // /auth hits cannot grow it without bound.
  const pendingStates = new Map();
  const STATE_TTL_MS = 10 * 60 * 1000;
  const MAX_PENDING_STATES = 10000;
  const takeState = (state, shop) => {
    const entry = pendingStates.get(state);
    pendingStates.delete(state);
    return !!entry && entry.shop === shop && entry.expires > Date.now();
  };
  const addState = (state, shop) => {
    const now = Date.now();
    for (const [key, entry] of pendingStates) {
      if (entry.expires <= now) pendingStates.delete(key);
    }
    while (pendingStates.size >= MAX_PENDING_STATES) {
      pendingStates.delete(pendingStates.keys().next().value); // oldest first
    }
    pendingStates.set(state, { shop, expires: now + STATE_TTL_MS });
  };

  // The settings page may only be framed by the shop's own admin (Shopify's
  // requirement for embedded apps, and no clickjacking from anywhere else).
  const frameGuard = (res, shop) => {
    const ancestors = shopify.isValidShopDomain(shop)
      ? `https://${shop} https://admin.shopify.com`
      : "'none'";
    res.set('Content-Security-Policy', `frame-ancestors ${ancestors};`);
  };

  app.use(express.urlencoded({ extended: false }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.get('/logo.png', (req, res) => res.sendFile(require('path').join(__dirname, '..', 'logo.png')));

  // ---- OAuth install flow ------------------------------------------------

  app.get('/auth', (req, res) => {
    const shop = String(req.query.shop || '');
    if (!shopify.isValidShopDomain(shop)) {
      return res.status(400).send('Invalid shop parameter. Expected x.myshopify.com');
    }
    const state = crypto.randomBytes(16).toString('hex');
    addState(state, shop);
    const url = shopify.buildAuthorizeUrl({
      shop,
      apiKey: cfg.apiKey,
      scopes: cfg.scopes,
      redirectUri: `${cfg.appUrl}/auth/callback`,
      state,
      adminBase: cfg.adminBase,
    });
    res.redirect(url);
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      const { shop, code, state } = req.query;
      if (!shopify.isValidShopDomain(shop)) {
        return res.status(400).send('Invalid shop');
      }
      if (!state || !takeState(String(state), shop)) {
        return res.status(403).send('Invalid OAuth state');
      }
      if (!shopify.verifyHmac(req.query, cfg.apiSecret)) {
        return res.status(403).send('HMAC verification failed');
      }

      const accessToken = await shopify.exchangeCodeForToken({
        shop, code,
        apiKey: cfg.apiKey,
        apiSecret: cfg.apiSecret,
        adminBase: cfg.adminBase,
      });

      const src = `${cfg.appUrl}/script.js?shop=${encodeURIComponent(shop)}`;
      const scriptTagId = await shopify.ensureScriptTag({
        shop, accessToken, src,
        apiVersion: cfg.apiVersion,
        adminBase: cfg.adminBase,
      });

      // Shopify deletes the ScriptTag itself on uninstall; this webhook lets
      // us drop the shop record and its access token at the same moment.
      await shopify.ensureWebhook({
        shop, accessToken,
        topic: 'app/uninstalled',
        address: `${cfg.appUrl}/webhooks/app/uninstalled`,
        apiVersion: cfg.apiVersion,
        adminBase: cfg.adminBase,
      });

      store.upsert(shop, { accessToken, scriptTagId, enabled: store.get(shop) ? store.get(shop).enabled : false });
      // Straight to settings: a short-lived token stands in for Shopify's launch signature.
      const token = session.issueToken(shop, cfg.apiSecret, 10 * 60 * 1000);
      res.redirect(`/app?shop=${encodeURIComponent(shop)}&session=${encodeURIComponent(token)}`);
    } catch (e) {
      res.status(502).send('Installation failed: ' + e.message);
    }
  });

  // ---- Webhooks --------------------------------------------------------------
  //
  // app/uninstalled (registered on install) and the three mandatory
  // compliance topics (set in the Partner dashboard under App setup >
  // Compliance webhooks, pointing at the URLs below). The HMAC is checked
  // against the raw body before anything is parsed.

  const WEBHOOK_TOPICS = {
    'app/uninstalled': (shop) => store.remove(shop),
    'shop/redact': (shop) => store.remove(shop),
    // The app keeps no customer data (only shop domain, token and bot
    // settings), so there is nothing to export or erase.
    'customers/data_request': () => {},
    'customers/redact': () => {},
  };

  app.post('/webhooks/:group/:event', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    const topic = `${req.params.group}/${req.params.event}`;
    const handle = WEBHOOK_TOPICS[topic];
    if (!handle) {
      return res.status(404).send('Unknown webhook');
    }
    if (!shopify.verifyWebhookHmac(req.body, req.get('X-Shopify-Hmac-Sha256'), cfg.apiSecret)) {
      return res.status(401).send('HMAC verification failed');
    }
    const shop = String(req.get('X-Shopify-Shop-Domain') || '');
    if (shopify.isValidShopDomain(shop) && store.get(shop)) {
      handle(shop);
    }
    res.status(200).send('ok');
  });

  // ---- Settings page -------------------------------------------------------

  // Only the shop's own admin may open or save its settings: the page opens
  // from Shopify's signed admin launch (hmac + fresh timestamp) or with the
  // token from the install, for a shop that installed the app; the form then
  // carries a token signed with the app secret.
  const launchedBy = (query, shop) =>
    (shopify.verifyHmac(query, cfg.apiSecret) && session.isFreshLaunch(query)) ||
    session.verifyToken(String(query.session || ''), shop, cfg.apiSecret);

  app.get('/app', (req, res) => {
    const shop = String(req.query.shop || '');
    frameGuard(res, shop);
    if (!shopify.isValidShopDomain(shop)) {
      return res.status(400).send('Missing or invalid shop parameter');
    }
    if (!store.get(shop) || !launchedBy(req.query, shop)) {
      return res.status(401).send('Open Conferbot from your Shopify admin (Apps > Conferbot).');
    }
    res.send(renderAdminPage({
      shop,
      record: store.get(shop),
      demoBotId: cfg.demoBotId,
      saved: req.query.saved === '1',
      formToken: session.issueToken(shop, cfg.apiSecret),
    }));
  });

  app.post('/app/save', (req, res) => {
    const shop = String(req.body.shop || '');
    frameGuard(res, shop);
    if (!shopify.isValidShopDomain(shop)) {
      return res.status(400).send('Missing or invalid shop parameter');
    }
    const formToken = String(req.body.token || '');
    if (!store.get(shop) || !session.verifyToken(formToken, shop, cfg.apiSecret)) {
      return res.status(401).send('This settings page has expired. Open Conferbot from your Shopify admin again.');
    }
    const botId = extractBotId(req.body.botId);
    const enabled = req.body.enabled === '1' && isValidBotId(botId);
    store.upsert(shop, {
      botId,
      enabled,
      embedType: req.body.embedType === 'popup_chat' ? 'popup_chat' : 'live_chat',
    });
    res.redirect(`/app?shop=${encodeURIComponent(shop)}&session=${encodeURIComponent(formToken)}&saved=1`);
  });

  // ---- Storefront loader (the ScriptTag src) --------------------------------

  app.get('/script.js', (req, res) => {
    const shop = String(req.query.shop || '');
    res.type('application/javascript');
    // Short CDN-friendly cache; storefronts pick up settings changes quickly.
    res.set('Cache-Control', 'public, max-age=300');
    if (!shopify.isValidShopDomain(shop)) {
      return res.send('/* conferbot: invalid shop */\n');
    }
    res.send(buildLoaderScript(store.get(shop), shop, cfg));
  });

  return { app, store };
}

module.exports = createApp;
