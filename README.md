# Conferbot Shopify App

Installs the [Conferbot](https://conferbot.com) AI chat widget on a Shopify storefront. Same product as the [PrestaShop module](https://github.com/Conferbot/conferbot-prestashop), Shopify-shaped: a small Node.js app that handles OAuth, registers a ScriptTag, and serves a per-shop widget loader.

## See it in action

Paste the Chatbot ID in the app settings, save, and the chat is live on the storefront (recorded against the mock storefront from the e2e suite):

![Conferbot Shopify demo: paste the bot ID in the app settings, save, chat appears on the storefront](docs/demo.gif)

[HD video (MP4)](docs/demo.mp4)

## How it works

```
merchant clicks install
  -> GET /auth?shop=x.myshopify.com          (redirect to Shopify OAuth)
  -> GET /auth/callback (HMAC + state check) (code -> access token)
  -> ScriptTag created: src = {APP_URL}/script.js?shop=x.myshopify.com
  -> merchant lands on /app (settings page: paste bot ID, flip switch)

every storefront page load
  -> Shopify injects <script src=".../script.js?shop=...">
  -> loader boots window.ConferbotWidget(botId, embedType, options)
     with { platform: "shopify", shopDomain, storeCurrency, user? }
```

The only merchant-facing setting is the **Chatbot ID** (paste the bare ID, the full embed snippet, or a dashboard URL - the ID is extracted automatically). A public demo bot (`691c970890527a0468f9b2c9`) is offered one-click so the widget works before signing up. All widget appearance/behavior is configured in the Conferbot dashboard and delivered at runtime.

## Project layout

```
src/
├── index.js         # entrypoint (listen)
├── server.js        # express app factory: /auth, /auth/callback, /app, /app/save, /script.js
├── config.js        # env-driven configuration
├── shopify.js       # OAuth HMAC verify, authorize URL, token exchange, ScriptTag API
├── widgetScript.js  # per-shop loader JS generation (script-context-safe JSON)
├── adminPage.js     # two-step settings page (same UX as the PrestaShop module)
└── store.js         # JSON-file shop store (swap for Redis/Postgres via same interface)
test/
├── unit.test.js     # HMAC, domains, bot IDs, loader generation, store, escaping
└── e2e.test.js      # full install journey against a mock Shopify + real-browser widget mount
```

## Setup

1. Create an app in the [Shopify Partner dashboard](https://partners.shopify.com) (Apps > Create app > public). Set the App URL to `{APP_URL}` and the redirect URL to `{APP_URL}/auth/callback`.
2. Copy `.env.example` to `.env` and fill in the API key/secret from the partner dashboard. `APP_URL` must be a public HTTPS URL (use `cloudflared`/`ngrok` in development).
3. `npm install && npm start`
4. Install on a dev store: open `{APP_URL}/auth?shop=your-dev-store.myshopify.com`, approve, paste a bot ID (or click the demo bot), save. The chat bubble appears on the storefront.

## Tests

28 tests via the built-in `node:test` runner - no test framework dependencies.

```bash
npm test                    # unit + API-level e2e (mock Shopify admin)
RUN_BROWSER_E2E=1 npm test  # + real headless-Chrome storefront: widget mounts from the CDN
```

The e2e suite spins up a mock Shopify admin (OAuth token endpoint + ScriptTag REST API) and drives the real app through: authorize redirect with CSRF state, signed callback (plus tampered-HMAC, forged-state, and reinstall-idempotency cases), settings save with full-snippet paste, loader no-op before configuration, loader output after, and finally a browser loading the loader from a fake storefront and asserting `<conferbot-widget>` mounts with `window.ConferbotWidget` defined.

## Production checklist (before App Store submission)

- [ ] `app/uninstalled` webhook to clean up shop records
- [ ] GDPR mandatory webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
- [ ] Session-token (App Bridge) auth for the embedded settings page
- [ ] Move the shop store to a real database
- [ ] Billing API if the app itself ever becomes paid (currently free; Conferbot subscription is the product)
- [ ] Theme app extension as an alternative to ScriptTag for Online Store 2.0 themes

## License

MIT.
