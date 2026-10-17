# Changelog

## 0.2.0 - 2026-10-17

Moves the app to what Shopify requires since 1 Oct 2026, when `scriptTagCreate` started failing and new installs could no longer get the widget (#7).

- Storefront widget is a theme app extension: the `conferbot-embed` app embed block (`target: body`) injects the same loader as before (same script URL, bot ID, embed type and options).
- The bot settings are written as app-data metafields (`conferbot.bot_id`, `enabled`, `embed_type`, `script_url`) on the app installation, which the app embed reads. No access scope is requested.
- Settings page step 3 deep-links to the theme editor with the Conferbot app embed switched on.
- Embedded admin uses App Bridge from Shopify's CDN; every settings call carries a session token, verified server-side (HS256, `exp`/`nbf`/`aud`, `iss` = `dest`). The home-grown signed query and form tokens are gone.
- Shopify-managed install with token exchange for an expiring offline access token, replacing the OAuth redirect flow (`/auth`, `/auth/callback` removed).
- GraphQL Admin API (2026-07) replaces REST. The app never creates ScriptTags; on stores installed with 0.1.0 the first save deletes the old ScriptTag (`scriptTags` + `scriptTagDelete`). `/script.js` still answers those ScriptTags until then.
- `shopify.app.toml` and `shopify.web.toml` for Shopify CLI, with placeholders for the Client ID and app URL. `app/uninstalled` and the three compliance webhooks are declared there.
- Tests rewritten against a mock token-exchange and GraphQL Admin API (42 tests), including session tokens, the metafield write, uninstall cleanup and the privacy webhooks. ESLint added (`npm run lint`).

## 0.1.0 - 2026-10-17

First tagged version of the Conferbot Shopify app (Express, OAuth). Not yet listed on the Shopify App Store.

- OAuth install flow, per-shop storage and a two-step settings page (paste the bot ID, turn it on).
- Storefront widget delivered through a `script.js` endpoint, with per-shop settings.
- Settings open and save only for the store admin, through signed, short-lived tokens carried by the settings form.
- Settings page sends `frame-ancestors` so only the Shopify admin can frame it; OAuth state is expiring and capped.
- Webhooks: HMAC verified; `app/uninstalled` is registered and drops the shop; the mandatory compliance webhooks are answered.
- Defaults to a supported Admin API version (also in `.env.example`).
- Bot ID help points to Share > Embed into your website in the Conferbot dashboard.
