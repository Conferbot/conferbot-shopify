'use strict';

/**
 * Generates the JavaScript served to storefronts by GET /script.js.
 * Same loader contract as every Conferbot embed:
 *   window.ConferbotWidget(botId, embedType, options)
 * Shop context rides in options.customData; Shopify customer identity is
 * picked up client-side from window.Shopify/meta when available.
 */

const BOT_ID_RE = /^[a-f0-9]{24}$/i;

function isValidBotId(id) {
  return BOT_ID_RE.test(String(id || ''));
}

function extractBotId(text) {
  const m = String(text || '').match(/[a-f0-9]{24}/i);
  return m ? m[0] : '';
}

/**
 * @param {object} shopRecord { botId, enabled }
 * @param {string} shopDomain x.myshopify.com
 * @param {object} cfg { widgetScriptUrl }
 * @returns {string} JavaScript source ('' contract: always valid JS)
 */
function buildLoaderScript(shopRecord, shopDomain, cfg) {
  if (!shopRecord || !shopRecord.enabled || !isValidBotId(shopRecord.botId)) {
    return '/* conferbot: not configured for this shop */\n';
  }

  const context = {
    botId: shopRecord.botId,
    embedType: shopRecord.embedType === 'popup_chat' ? 'popup_chat' : 'live_chat',
    scriptUrl: cfg.widgetScriptUrl,
    shop: shopDomain,
  };
  // JSON_HEX-equivalent: keep the inlined JSON inert inside a script context.
  const json = JSON.stringify(context)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  return `(function () {
  var cfg = ${json};
  if (document.getElementById('conferbot-js')) return;
  var js = document.createElement('script');
  js.async = true;
  js.src = cfg.scriptUrl;
  js.id = 'conferbot-js';
  js.charset = 'UTF-8';
  js.onload = function () {
    var options = { customData: { platform: 'shopify', shopDomain: cfg.shop } };
    try {
      if (window.Shopify && window.Shopify.shop) options.customData.shopDomain = window.Shopify.shop;
      if (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) {
        options.customData.storeCurrency = window.Shopify.currency.active;
      }
      var c = window.__st || {};
      if (c.cid) options.user = { id: 'shopify-' + c.cid };
    } catch (e) {}
    window.ConferbotWidget(cfg.botId, cfg.embedType, options);
  };
  (document.head || document.documentElement).appendChild(js);
})();
`;
}

module.exports = { isValidBotId, extractBotId, buildLoaderScript };
