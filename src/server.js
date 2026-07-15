'use strict';

const crypto = require('crypto');
const express = require('express');
const shopify = require('./shopify');
const ShopStore = require('./store');
const { buildLoaderScript, extractBotId, isValidBotId } = require('./widgetScript');
const { renderAdminPage } = require('./adminPage');

/**
 * App factory - takes config so tests can inject a mock Shopify admin base
 * and a temp data file. Returns { app, store }.
 */
function createApp(cfg) {
  const app = express();
  const store = new ShopStore(cfg.dataFile);
  const pendingStates = new Map(); // state nonce -> shop (single-instance OAuth CSRF guard)

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
    pendingStates.set(state, shop);
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
      if (!state || pendingStates.get(state) !== shop) {
        return res.status(403).send('Invalid OAuth state');
      }
      pendingStates.delete(state);
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

      store.upsert(shop, { accessToken, scriptTagId, enabled: store.get(shop) ? store.get(shop).enabled : false });
      res.redirect(`/app?shop=${encodeURIComponent(shop)}`);
    } catch (e) {
      res.status(502).send('Installation failed: ' + e.message);
    }
  });

  // ---- Settings page -------------------------------------------------------

  app.get('/app', (req, res) => {
    const shop = String(req.query.shop || '');
    if (!shopify.isValidShopDomain(shop)) {
      return res.status(400).send('Missing or invalid shop parameter');
    }
    res.send(renderAdminPage({
      shop,
      record: store.get(shop),
      demoBotId: cfg.demoBotId,
      saved: req.query.saved === '1',
    }));
  });

  app.post('/app/save', (req, res) => {
    const shop = String(req.body.shop || '');
    if (!shopify.isValidShopDomain(shop)) {
      return res.status(400).send('Missing or invalid shop parameter');
    }
    const botId = extractBotId(req.body.botId);
    const enabled = req.body.enabled === '1' && isValidBotId(botId);
    store.upsert(shop, {
      botId,
      enabled,
      embedType: req.body.embedType === 'popup_chat' ? 'popup_chat' : 'live_chat',
    });
    res.redirect(`/app?shop=${encodeURIComponent(shop)}&saved=1`);
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
