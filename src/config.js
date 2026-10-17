'use strict';

/**
 * All environment-driven configuration in one place.
 * SHOPIFY_ADMIN_BASE exists so tests can point the token-exchange and
 * GraphQL calls at a mock server; in production it resolves to https://{shop}.
 *
 * `shopify app dev` passes SHOPIFY_API_KEY, SHOPIFY_API_SECRET, APP_URL (or
 * HOST) and PORT to this process, so the same names work locally and hosted.
 */
module.exports = {
  port: parseInt(process.env.PORT || '3055', 10),
  appUrl: process.env.APP_URL || process.env.HOST || 'http://localhost:3055',
  apiKey: process.env.SHOPIFY_API_KEY || '',
  apiSecret: process.env.SHOPIFY_API_SECRET || '',
  apiVersion: process.env.SHOPIFY_API_VERSION || '2026-07',
  // '{shop}' placeholder is replaced with the myshopify domain.
  adminBase: process.env.SHOPIFY_ADMIN_BASE || 'https://{shop}',
  // Theme app extension block handle (extensions/conferbot-embed/blocks/<handle>.liquid),
  // used for the theme editor deep link that switches the app embed on.
  embedHandle: 'conferbot-embed',
  widgetScriptUrl: process.env.CONFERBOT_WIDGET_URL || 'https://cdn.conferbot.com/dist/v1/widget.min.js',
  demoBotId: '691c970890527a0468f9b2c9',
  dataFile: process.env.DATA_FILE || require('path').join(__dirname, '..', 'data', 'shops.json'),
};
