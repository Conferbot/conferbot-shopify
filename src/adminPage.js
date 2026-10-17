'use strict';

/**
 * The app's settings page - same two-step design as the PrestaShop module:
 * paste the bot ID (auto-extracted from anything), flip the switch, save -
 * plus the one Shopify step: switch the app embed on in the theme editor.
 *
 * The page is embedded in the Shopify admin. App Bridge loads first; the page
 * reads and saves its settings through /api/settings with a session token
 * (shopify.idToken()), so the HTML itself carries no shop data.
 */

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderAdminPage({ apiKey, demoBotId }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="shopify-api-key" content="${escapeHtml(apiKey)}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conferbot - AI Chatbot, Live Chat &amp; Customer Support</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #f6f6f7; margin: 0; }
  .cb-panel { max-width: 720px; margin: 40px auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); padding: 32px 36px; font-size: 15px; }
  h2 { display: flex; align-items: center; gap: 10px; font-size: 24px; margin: 0 0 6px; }
  .cb-sub { color: #6b7280; margin-bottom: 24px; }
  .cb-status { border-radius: 10px; padding: 14px 18px; margin-bottom: 26px; }
  .cb-status.ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .cb-status.warn { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
  .cb-step { margin-bottom: 26px; }
  .cb-step-label { font-weight: 700; font-size: 17px; margin-bottom: 6px; display: block; }
  .cb-step-help { color: #6b7280; margin-bottom: 10px; }
  .cb-input { width: 100%; box-sizing: border-box; font-size: 18px; padding: 14px 16px; border: 2px solid #d1d5db; border-radius: 10px; }
  .cb-input:focus { border-color: #2563eb; outline: none; }
  .cb-switch { position: relative; display: inline-block; width: 64px; height: 34px; vertical-align: middle; }
  .cb-switch input { opacity: 0; width: 0; height: 0; }
  .cb-slider { position: absolute; cursor: pointer; inset: 0; background: #d1d5db; border-radius: 34px; transition: .2s; }
  .cb-slider:before { content: ""; position: absolute; height: 26px; width: 26px; left: 4px; bottom: 4px; background: #fff; border-radius: 50%; transition: .2s; }
  .cb-switch input:checked + .cb-slider { background: #16a34a; }
  .cb-switch input:checked + .cb-slider:before { transform: translateX(30px); }
  .cb-switch-text { margin-left: 12px; vertical-align: middle; font-size: 16px; }
  .cb-save { display: block; width: 100%; margin-top: 8px; background: #2563eb; color: #fff; border: none; border-radius: 10px; padding: 16px; font-size: 19px; font-weight: 700; cursor: pointer; }
  .cb-save:hover { background: #1d4ed8; }
  .cb-demo { margin-top: 8px; color: #6b7280; font-size: 14px; }
  .cb-advanced { margin-top: 28px; border-top: 1px solid #e5e7eb; padding-top: 18px; }
  .cb-advanced summary { cursor: pointer; color: #6b7280; font-weight: 600; font-size: 14px; }
  .cb-select { font-size: 15px; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; margin-top: 12px; }
  .cb-help { margin-top: 18px; text-align: center; color: #6b7280; }
  .cb-embed-link { display: inline-block; background: #fff; color: #2563eb; border: 2px solid #2563eb; border-radius: 10px; padding: 10px 16px; font-weight: 700; text-decoration: none; }
  .cb-embed-link:hover { background: #eff6ff; }
  .cb-save[disabled] { opacity: .6; cursor: wait; }
</style>
</head>
<body>
<div class="cb-panel">
  <h2><img src="/logo.png" alt="Conferbot" style="width:44px;height:44px"> Conferbot Live Chat</h2>
  <p class="cb-sub">Add a chat assistant to <strong id="cb-shop">your store</strong> in under a minute. Only one thing to paste!</p>
  <div id="cb-status" class="cb-status warn">Loading your settings...</div>
  <form id="cb-form">
    <div class="cb-step">
      <label class="cb-step-label" for="cb-id">1. Paste your Chatbot ID</label>
      <div class="cb-step-help">
        Find it in your <a href="https://app.conferbot.com" target="_blank" rel="noopener">Conferbot dashboard</a>:
        open your bot, click "Share", then "Embed into your website". The ID is the 24-character code inside
        <code>ConferbotWidget("...")</code> in the snippet (it is also in the address bar: .../chatbot/<em>ID</em>/embed).
        Pasting the whole snippet works too - we will find the ID for you.
      </div>
      <input class="cb-input" type="text" id="cb-id" name="botId" value=""
             placeholder="e.g. 64a1b2c3d4e5f6a7b8c9d0e1">
      <div class="cb-demo">
        No account yet?
        <a href="#" id="cb-use-demo" data-demo-id="${escapeHtml(demoBotId)}">Try our demo bot</a>
        - it works right away, no signup needed.
      </div>
    </div>
    <div class="cb-step">
      <span class="cb-step-label">2. Turn the chat on</span>
      <label class="cb-switch">
        <input type="checkbox" id="cb-enabled" name="enabled" value="1">
        <span class="cb-slider"></span>
      </label>
      <span class="cb-switch-text">Show the chat bubble on my store</span>
    </div>
    <div class="cb-step">
      <span class="cb-step-label">3. Switch on Conferbot in your theme</span>
      <div class="cb-step-help">
        Shopify adds the chat to your storefront through your theme. Do this once: open the theme editor,
        make sure <strong>Conferbot</strong> is switched on under <strong>App embeds</strong>, then click <strong>Save</strong>.
      </div>
      <a class="cb-embed-link" id="cb-embed-link" href="#" target="_top">Open the theme editor (App embeds)</a>
    </div>
    <button class="cb-save" id="cb-save" type="submit">Save - start chatting with my customers 🎉</button>
    <details class="cb-advanced">
      <summary>Advanced settings (optional - the defaults are fine)</summary>
      <label for="cb-embed" style="display:block;margin-top:12px;font-weight:600">How the chat appears</label>
      <select class="cb-select" id="cb-embed" name="embedType">
        <option value="live_chat">Floating chat bubble (recommended)</option>
        <option value="popup_chat">Popup window</option>
      </select>
    </details>
  </form>
  <p class="cb-help">Need help? Write to <a href="mailto:support@conferbot.com">support@conferbot.com</a></p>
</div>
<script>
(function () {
  var form = document.getElementById('cb-form');
  var input = document.getElementById('cb-id');
  var toggle = document.getElementById('cb-enabled');
  var embed = document.getElementById('cb-embed');
  var statusEl = document.getElementById('cb-status');
  var saveBtn = document.getElementById('cb-save');
  var embedLink = document.getElementById('cb-embed-link');

  function show(kind, text) {
    statusEl.className = 'cb-status ' + kind;
    statusEl.textContent = text;
  }

  function describe(s, saved) {
    if (saved && s.enabled) return show('ok', '✅ Saved! If you have not yet, switch on Conferbot under App embeds in the theme editor (step 3) and the chat goes live.');
    if (saved) return show('ok', '✅ Saved. The chat stays off on your storefront until you turn it on.');
    if (!s.botId) return show('warn', '👇 Just one step: paste your Chatbot ID below and press the big blue button.');
    if (!s.enabled) return show('warn', '⏸️ The chat is currently switched OFF. Turn it on below when you are ready.');
    return show('ok', '✅ All set! The chat shows on your store while Conferbot is on under App embeds (step 3).');
  }

  function fill(s) {
    document.getElementById('cb-shop').textContent = s.shop;
    input.value = s.botId || '';
    toggle.checked = !!s.enabled;
    embed.value = s.embedType === 'popup_chat' ? 'popup_chat' : 'live_chat';
    if (s.themeEditorUrl) embedLink.href = s.themeEditorUrl;
  }

  // Every call carries a fresh App Bridge session token.
  function api(method, body) {
    if (!window.shopify || typeof window.shopify.idToken !== 'function') {
      return Promise.reject(new Error('Open Conferbot from your Shopify admin (Apps > Conferbot).'));
    }
    return window.shopify.idToken().then(function (token) {
      var opts = { method: method, headers: { Authorization: 'Bearer ' + token } };
      if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      return fetch('/api/settings', opts);
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  api('GET').then(function (s) { fill(s); describe(s, false); })
    .catch(function (e) { show('warn', e.message); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    saveBtn.disabled = true;
    api('POST', { botId: input.value, enabled: toggle.checked ? '1' : '', embedType: embed.value })
      .then(function (s) { fill(s); describe(s, true); })
      .catch(function (err) { show('warn', err.message); })
      .then(function () { saveBtn.disabled = false; });
  });

  document.getElementById('cb-use-demo').addEventListener('click', function (e) {
    e.preventDefault();
    input.value = this.getAttribute('data-demo-id');
    toggle.checked = true;
    input.focus();
  });
})();
</script>
</body>
</html>`;
}

module.exports = { renderAdminPage, escapeHtml };
