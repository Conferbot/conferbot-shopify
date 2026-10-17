# Changelog

## 0.1.0 - 2026-10-17

First tagged version of the Conferbot Shopify app (Express, OAuth). Not yet listed on the Shopify App Store.

- OAuth install flow, per-shop storage and a two-step settings page (paste the bot ID, turn it on).
- Storefront widget delivered through a `script.js` endpoint, with per-shop settings.
- Settings open and save only for the store admin, through signed, short-lived tokens carried by the settings form.
- Settings page sends `frame-ancestors` so only the Shopify admin can frame it; OAuth state is expiring and capped.
- Webhooks: HMAC verified; `app/uninstalled` is registered and drops the shop; the mandatory compliance webhooks are answered.
- Defaults to a supported Admin API version (also in `.env.example`).
- Bot ID help points to Share > Embed into your website in the Conferbot dashboard.
