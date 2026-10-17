'use strict';

const path = require('path');
const express = require('express');
const shopify = require('./shopify');
const ShopStore = require('./store');
const { buildLoaderScript, extractBotId, isValidBotId } = require('./widgetScript');
const { renderAdminPage } = require('./adminPage');
const { verifySessionToken, bearerToken } = require('./session');

// Renew the offline token this long before Shopify says it expires.
const TOKEN_SAFETY_MS = 60 * 1000;

/**
 * App factory - takes config so tests can inject a mock Shopify admin base
 * and a temp data file. Returns { app, store }.
 *
 * Install is Shopify-managed (scopes in shopify.app.toml): Shopify installs
 * the app and opens /app inside the admin. The page loads App Bridge, and
 * every call it makes to /api/* carries a session token, which is checked and
 * exchanged for an expiring offline access token on first use.
 */
function createApp(cfg) {
  const app = express();
  const store = new ShopStore(cfg.dataFile);
  const adminOpts = () => ({ apiVersion: cfg.apiVersion, adminBase: cfg.adminBase });

  // The settings page may only be framed by the shop's own admin (Shopify's
  // requirement for embedded apps, and no clickjacking from anywhere else).
  const frameGuard = (res, shop) => {
    const ancestors = shopify.isValidShopDomain(shop)
      ? `https://${shop} https://admin.shopify.com`
      : "'none'";
    res.set('Content-Security-Policy', `frame-ancestors ${ancestors};`);
  };

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.get('/logo.png', (req, res) => res.sendFile(path.join(__dirname, '..', 'logo.png')));

  // ---- Settings page (embedded in the Shopify admin) ------------------------
  //
  // The page itself holds no shop data; it loads App Bridge and fetches the
  // settings from /api/settings with a session token.

  app.get(['/', '/app'], (req, res) => {
    frameGuard(res, String(req.query.shop || ''));
    res.set('Cache-Control', 'no-store');
    res.send(renderAdminPage({ apiKey: cfg.apiKey, demoBotId: cfg.demoBotId }));
  });

  // ---- Session-token auth for /api/* ------------------------------------------

  const unauthorized = (res, message) => {
    // App Bridge sees this header, fetches a fresh session token and retries once.
    res.set('X-Shopify-Retry-Invalid-Session-Request', '1');
    return res.status(401).json({ error: message });
  };

  /** Returns a usable offline access token for the shop, exchanging if needed. */
  async function offlineToken(shop, idToken) {
    const record = store.get(shop);
    if (record && record.accessToken && record.accessTokenExpiresAt &&
        record.accessTokenExpiresAt - TOKEN_SAFETY_MS > Date.now()) {
      return record.accessToken;
    }
    const patch = {};
    // A 0.1.0 install holds a non-expiring token from the old OAuth flow that
    // still carries write_script_tags: keep it only to delete the old ScriptTag.
    if (record && record.accessToken && !record.accessTokenExpiresAt && record.scriptTagId) {
      patch.legacyAccessToken = record.accessToken;
    }
    const token = await shopify.exchangeToken({
      shop, idToken, apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, adminBase: cfg.adminBase,
    });
    patch.accessToken = token.accessToken;
    // Shopify returns expires_in for expiring tokens; without it, renew within the hour.
    patch.accessTokenExpiresAt = token.expiresAt || Date.now() + 60 * 60 * 1000;
    store.upsert(shop, patch);
    return token.accessToken;
  }

  const requireSession = async (req, res, next) => {
    const idToken = bearerToken(req.get('Authorization'));
    const session = verifySessionToken(idToken, { apiKey: cfg.apiKey, apiSecret: cfg.apiSecret });
    if (!session) {
      return unauthorized(res, 'Open Conferbot from your Shopify admin (Apps > Conferbot).');
    }
    req.shop = session.shop;
    frameGuard(res, session.shop);
    try {
      req.accessToken = await offlineToken(session.shop, idToken);
    } catch (e) {
      return res.status(502).json({ error: `Could not connect to Shopify: ${e.message}` });
    }
    next();
  };

  const settingsView = (shop) => {
    const record = store.get(shop) || {};
    return {
      shop,
      botId: record.botId || '',
      enabled: !!record.enabled,
      embedType: record.embedType === 'popup_chat' ? 'popup_chat' : 'live_chat',
      themeEditorUrl: shopify.themeEditorEmbedUrl(shop, cfg.apiKey, cfg.embedHandle),
    };
  };

  app.get('/api/settings', requireSession, (req, res) => {
    res.json(settingsView(req.shop));
  });

  app.post('/api/settings', express.json({ limit: '16kb' }), express.urlencoded({ extended: false, limit: '16kb' }),
    requireSession, async (req, res) => {
      const body = req.body || {};
      const botId = extractBotId(body.botId);
      const enabled = (body.enabled === true || body.enabled === '1') && isValidBotId(botId);
      const embedType = body.embedType === 'popup_chat' ? 'popup_chat' : 'live_chat';
      const shop = req.shop;
      try {
        const appInstallationId = await shopify.saveSettingsMetafields({
          shop,
          accessToken: req.accessToken,
          appInstallationId: (store.get(shop) || {}).appInstallationId,
          settings: { botId, enabled, embedType, scriptUrl: cfg.widgetScriptUrl },
          ...adminOpts(),
        });
        store.upsert(shop, { botId, enabled, embedType, appInstallationId });
      } catch (e) {
        return res.status(502).json({ error: `Could not save to Shopify: ${e.message}` });
      }

      // The app embed now carries the widget, so the 0.1.0 ScriptTag can go.
      // Best effort: a failure here never fails the save.
      const record = store.get(shop);
      if (record.legacyAccessToken || record.scriptTagId) {
        try {
          await shopify.deleteLegacyScriptTags({
            shop, accessToken: record.legacyAccessToken || req.accessToken, ...adminOpts(),
          });
          store.upsert(shop, { legacyAccessToken: undefined, scriptTagId: undefined });
        } catch (e) {
          console.warn(`conferbot-shopify: legacy ScriptTag cleanup for ${shop} failed: ${e.message}`);
        }
      }

      res.json({ ...settingsView(shop), saved: true });
    });

  // ---- Webhooks --------------------------------------------------------------
  //
  // app/uninstalled and the three mandatory compliance topics, declared in
  // shopify.app.toml and pointing at the URLs below. The HMAC is checked
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

  // ---- Legacy storefront loader ------------------------------------------------
  //
  // 0.1.0 installs have a ScriptTag pointing here until the merchant saves the
  // settings once after the upgrade (which deletes it). Shopify stops
  // injecting ScriptTags on 1 Mar 2027; drop this route after that.

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
