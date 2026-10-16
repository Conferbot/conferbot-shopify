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

The only merchant-facing setting is the **Chatbot ID** (paste the bare ID, the full embed snippet, or a dashboard URL - the ID is extracted automatically). A public demo bot (`691c970890527a0468f9b2c9`) is offered one-click so the widget works before signing up. Everything visitors see is set per bot in the Conferbot dashboard and delivered at runtime, with nothing to configure in the store: flows and AI agents, live chat with handover to your team (queue position, leave a message when nobody is free, read receipts, file sharing, post-chat rating), the home screen, themes and dark mode, colours, launcher and mascot, greetings, languages and disabled URLs.

The settings page opens only for the shop's own admin: from Shopify's signed admin launch (HMAC and a fresh timestamp) or with the short-lived token from the install, and every save carries a token signed with the app secret. A bare `?shop=` is refused.

## Project layout

```
src/
├── index.js         # entrypoint (listen)
├── server.js        # express app factory: /auth, /auth/callback, /app, /app/save, /script.js, /webhooks/*
├── config.js        # env-driven configuration
├── shopify.js       # OAuth + webhook HMAC verify, authorize URL, token exchange, ScriptTag + webhook API
├── widgetScript.js  # per-shop loader JS generation (script-context-safe JSON)
├── adminPage.js     # two-step settings page (same UX as the PrestaShop module)
└── store.js         # JSON-file shop store (swap for Redis/Postgres via same interface)
test/
├── unit.test.js     # HMAC, domains, bot IDs, loader generation, store, escaping
└── e2e.test.js      # full install journey against a mock Shopify + real-browser widget mount
```

## Install guide

### Requirements

- A Shopify store on any plan, with an **Online Store** sales channel. The widget is added with a ScriptTag, which Shopify loads on Online Store pages (vintage and Online Store 2.0 themes). It does not run on the checkout or the new Thank you / Order status pages.
- A Conferbot account and a bot (free plan is fine), or the demo bot to try it first.
- To host the app yourself: Node.js 18 or newer, a public HTTPS URL, and a Shopify Partner account.

### Install from the Shopify App Store

The app is not listed in the Shopify App Store yet. Until it is, install it as a custom/self-hosted app (below), or paste the embed code into your theme (Conferbot dashboard > your bot > Share > Embed into your website > Shopify).

When it is listed: Shopify admin > **Apps** > **Shopify App Store**, search for **Conferbot**, click **Install**, approve the permission (`write_script_tags`: lets the app add one script to your storefront), and you land on the Conferbot settings page.

### Install self-hosted (manual)

1. In the [Shopify Partner dashboard](https://partners.shopify.com): **Apps** > **Create app** > **Create app manually**. Under **Configuration**:
   - App URL: `{APP_URL}/app`
   - Allowed redirection URL: `{APP_URL}/auth/callback`
   - Compliance webhooks: `{APP_URL}/webhooks/customers/data_request`, `{APP_URL}/webhooks/customers/redact`, `{APP_URL}/webhooks/shop/redact`
2. Get the code and configure it:
   ```bash
   git clone https://github.com/Conferbot/conferbot-shopify.git
   cd conferbot-shopify
   cp .env.example .env    # fill SHOPIFY_API_KEY, SHOPIFY_API_SECRET, APP_URL
   npm ci
   npm start               # listens on :3055
   ```
   `APP_URL` must be the public HTTPS address of this server (in development, a `cloudflared` or `ngrok` tunnel to port 3055). Keep `data/` on persistent storage: it holds each shop's access token and settings.
3. Install on your store: open `{APP_URL}/auth?shop=your-store.myshopify.com`, approve, and you land on the settings page. On install the app creates one ScriptTag (`{APP_URL}/script.js?shop=...`) and subscribes to `app/uninstalled`.

### Find your bot ID

1. Sign in at [app.conferbot.com](https://app.conferbot.com) and open your bot.
2. Click **Share**, then **Embed into your website**.
3. The bot ID is the 24-character code inside `ConferbotWidget("...")` in the snippet, e.g. `64a1b2c3d4e5f6a7b8c9d0e1`. It is also in the address bar: `.../chatbot/<bot ID>/embed`.

You can paste the bare ID, the whole snippet, or the dashboard URL; the app pulls the ID out.

### Settings

Open the app from Shopify admin > **Apps** > **Conferbot**.

| Setting | What it does |
| --- | --- |
| **Chatbot ID** | The bot to show. Required before the chat can be switched on. "Try our demo bot" fills a public demo bot. |
| **Turn the chat on** | On/off switch. Off (or no valid ID) serves an empty loader, so nothing loads on the storefront. |
| **How the chat appears** (Advanced) | Floating chat bubble (`live_chat`, default) or popup window (`popup_chat`). |

Everything else (flows, AI agent, live chat handover, colours, launcher, greetings, languages, pages to hide on) is set per bot in the Conferbot dashboard and picked up at runtime.

### Check it works

1. Save with the switch on.
2. Open your storefront in a private window. The chat bubble appears in the corner within a few seconds; click it and send a message.
3. Not there yet? The loader is cached for up to 5 minutes; wait and reload. You can also open `{APP_URL}/script.js?shop=your-store.myshopify.com`: it should mention your bot ID, not `not configured`.

### Troubleshooting

- **"Open Conferbot from your Shopify admin"**: the settings page only opens from Shopify's signed launch (Apps > Conferbot) or right after install. A bookmarked `/app?shop=...` link is refused on purpose.
- **"This settings page has expired"**: the page was open for over an hour. Reopen it from Apps > Conferbot.
- **No bubble on the storefront**: check the switch is on and the ID is valid; check the script is listed (`GET /admin/api/2026-07/script_tags.json`); make sure a theme or other app does not already load `conferbot-js` (the loader skips itself if the widget is already on the page, so a hard-coded snippet in `theme.liquid` with another bot ID wins).
- **Bubble shows but not on some pages**: "Disabled URLs" in the bot's Conferbot settings hide it on matching pages. Checkout and the Thank you page never run ScriptTags.
- **Installation failed: HTTP 4xx**: wrong API key/secret, or the redirect URL in the Partner dashboard does not match `{APP_URL}/auth/callback` exactly.

### Uninstall

Shopify admin > **Settings** > **Apps and sales channels** > **Conferbot** > **Uninstall**. Shopify deletes the ScriptTag, so the chat leaves the storefront at once, and the `app/uninstalled` webhook deletes the shop's record and access token from this app. Your bot and conversations stay in your Conferbot account.

## Tests

34 tests via the built-in `node:test` runner - no test framework dependencies.

```bash
npm test                    # unit + API-level e2e (mock Shopify admin)
RUN_BROWSER_E2E=1 npm test  # + real headless-Chrome storefront: widget mounts from the CDN
```

The e2e suite spins up a mock Shopify admin (OAuth token endpoint + ScriptTag REST API) and drives the real app through: authorize redirect with CSRF state, signed callback (plus tampered-HMAC, forged-state, and reinstall-idempotency cases), settings save with full-snippet paste, loader no-op before configuration, loader output after, and finally a browser loading the loader from a fake storefront and asserting `<conferbot-widget>` mounts with `window.ConferbotWidget` defined.

## Production checklist (before App Store submission)

- [x] `app/uninstalled` webhook to clean up shop records
- [x] GDPR mandatory webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
- [ ] Session-token (App Bridge) auth for the embedded settings page (#7)
- [ ] Move the shop store to a real database
- [ ] Billing API if the app itself ever becomes paid (currently free; Conferbot subscription is the product)
- [ ] Theme app extension as an alternative to ScriptTag for Online Store 2.0 themes, and GraphQL Admin API (#7)

## License

MIT.
