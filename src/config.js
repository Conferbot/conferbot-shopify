'use strict';

/**
 * All environment-driven configuration in one place.
 * SHOPIFY_ADMIN_BASE exists so tests can point the OAuth/REST calls at a
 * mock server; in production it resolves to https://{shop}.
 */
module.exports = {
  port: parseInt(process.env.PORT || '3055', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3055',
  apiKey: process.env.SHOPIFY_API_KEY || '',
  apiSecret: process.env.SHOPIFY_API_SECRET || '',
  scopes: process.env.SHOPIFY_SCOPES || 'write_script_tags',
  apiVersion: process.env.SHOPIFY_API_VERSION || '2026-07',
  // '{shop}' placeholder is replaced with the myshopify domain.
  adminBase: process.env.SHOPIFY_ADMIN_BASE || 'https://{shop}',
  widgetScriptUrl: process.env.CONFERBOT_WIDGET_URL || 'https://cdn.conferbot.com/dist/v1/widget.min.js',
  demoBotId: '691c970890527a0468f9b2c9',
  dataFile: process.env.DATA_FILE || require('path').join(__dirname, '..', 'data', 'shops.json'),
};
