# Shopify App Store: submission kit

Everything needed to list the Conferbot Shopify app (0.2.0) on the Shopify App Store. Checked against shopify.dev on 2026-10-17. The code meets the platform requirements as of 0.2.0 (#7 is done). **What is left is on the owner side:** hosting, real credentials, and the Partner account (section 3).

## 1. Where to submit

| What | Where |
| --- | --- |
| Account | A **Shopify Partner account**: https://partners.shopify.com (company profile, plus an emergency developer contact with email and phone). Apps are created and configured in the **Dev Dashboard** (Partners > Apps). |
| Submission | Dev Dashboard > your app > **Distribution > Shopify App Store > Create listing**, then **Submit for review** (the automated checks must pass first). https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review |
| Requirements | https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements |
| Fees | A one-time **$19 USD** Partner registration fee for App Store distribution and revenue share. Revenue share: 0% on the first $1M of app revenue, then 15%, plus 2.9% processing. It only matters if the app itself charges, and this one does not. |

## 2. Current requirements and where we stand

| Requirement | Status |
| --- | --- |
| **Storefront code via a theme app extension (app embed block)**, not ScriptTag (requirement 5.1.1). `scriptTagCreate` returns errors from **1 Oct 2026**, and storefronts stop injecting script tags on **1 Mar 2027**. | OK (0.2.0). `extensions/conferbot-embed` app embed block, settings in app-data metafields, theme editor deep link on the settings page. 0.1.0 ScriptTags are deleted on the first save after the upgrade. |
| Embedded admin: latest App Bridge loaded first, session-token auth, works without third-party cookies (1.1.1) | OK (0.2.0). App Bridge from `cdn.shopify.com` is the first script; `/api/settings` accepts only verified session tokens; no cookies. |
| New public apps use the **GraphQL Admin API** only, with **expiring offline tokens** | OK (0.2.0). GraphQL 2026-07 only (`currentAppInstallation`, `metafieldsSet`, `scriptTags`/`scriptTagDelete` for cleanup); token exchange requests expiring offline tokens; webhooks are declared in `shopify.app.toml`. |
| OAuth immediately on install, before anything else; never ask for the myshopify domain (2.3.1, 2.3.2) | OK. Shopify-managed install (`use_legacy_install_flow = false`), then token exchange; the app never asks for the shop domain. |
| Mandatory compliance webhooks `customers/data_request`, `customers/redact`, `shop/redact`, with 401 on a bad HMAC | OK. All three are implemented, HMAC-checked (401) and declared as `compliance_topics` in `shopify.app.toml`. **Risk:** the two customer topics are no-ops because the app stores no customer data, but the widget passes the logged-in customer ID (`shopify-<id>`) to Conferbot. A reviewer may ask how a redact reaches Conferbot. Have an answer ready: the handler forwards the request to support@conferbot.com, or calls a Conferbot deletion API. |
| Billing through Shopify if the app charges | Not applicable: the app is free. **Risk:** list it as "Free to install"; Conferbot plans are billed by Conferbot. Shopify can ask that any upgrade path inside the app go through Shopify Billing, and the app has none. |
| Unique name that leads with your brand; Shopify marks only to state compatibility; no "Shopify" in URLs or emails (4.1.1, 4.1.2) | OK with the name below. |
| Hosted, persistent, HTTPS app | **To do.** The app needs a public `APP_URL` and a real database (`src/store.js` is a JSON file). |
| Test store and credentials for the reviewer, plus a screencast of onboarding | To do after hosting. |

Review: Shopify quotes 5–10 business days; 2026 reports say 2–3+ weeks.

## 3. What is left (owner)

The code blocker (#7) is fixed in 0.2.0. Left:

1. **Hosting**: a public HTTPS `APP_URL` (pick a subdomain; it must not contain "shopify"), a persistent database for shop tokens (`src/store.js` is a JSON file), and env vars `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `APP_URL`.
2. **Credentials**: create the app in the Dev Dashboard, put its Client ID and the `APP_URL` into `shopify.app.toml` (the placeholders `YOUR_SHOPIFY_CLIENT_ID` and `https://your-app.example.com`), keep the secret only on the host, then `shopify app deploy` (pushes the URLs, webhooks and the `conferbot-embed` theme app extension).
3. **Partner account** ($19), emergency contact, a development store for the reviewer, and a screencast.

## 4. Listing copy (ready to paste)

| Field | Limit | Copy |
| --- | --- | --- |
| App name | 30 | `Conferbot AI Chatbot` |
| App introduction | 100 | `AI chatbot and live chat that answer shoppers 24/7, capture leads and hand over to your team.` |
| App details | 500 | `Conferbot puts an AI chat assistant on your storefront. It answers product, shipping and order questions instantly, collects leads, and hands shoppers to a person on your team when they need one, with queue position, file sharing and a post-chat rating. Setup is one step: paste your Chatbot ID and switch it on in the theme editor. The widget's look, AI agent, flows, greetings and languages are managed in your Conferbot dashboard and apply at once.` |
| Feature 1 | 80 | `AI agent trained on your content answers shoppers 24/7` |
| Feature 2 | 80 | `Live chat handover to your team, with an offline message form` |
| Feature 3 | 80 | `Lead capture and qualification built into the chat` |
| Feature 4 | 80 | `One-step setup: paste your Chatbot ID, enable the app embed` |
| Feature 5 | 80 | `Brand the widget: colours, logo, launcher, greetings, languages` |
| Search terms | 5 | `chatbot`, `live chat`, `ai chatbot`, `customer support`, `chat widget` |
| Pricing | | **Free to install.** "A Conferbot account is required; Conferbot's free plan is enough to start (no card). Paid Conferbot plans are billed by Conferbot." |
| Categories | | Store management > Support > *Chat* (primary); *FAQ / Helpdesk* if offered |
| Support email | | `support@conferbot.com` (the address in the app's settings page and package.json) |
| Privacy policy URL | | https://www.conferbot.com/privacy-policy (HTTP 200) |
| Terms / FAQ | | https://www.conferbot.com/terms-of-service (HTTP 200); docs https://docs.conferbot.com |
| API contact email | | `support@conferbot.com` (must not contain "shopify") |

### Data and GDPR statement

This statement matches `src/store.js`, `src/server.js` and `src/widgetScript.js`.

- **The app server stores** only, per shop: the myshopify domain, the offline access token and its expiry, the app installation id, and the settings (bot ID, switch, embed type). The same settings are written to app-data metafields on the shop, which Shopify deletes with the app. The record is deleted on `app/uninstalled` and `shop/redact`.
- **It stores no customer data.** Shopify's `customers/data_request` and `customers/redact` therefore have nothing to export or erase in the app itself.
- **Scope:** none. The app embed needs no scope, and app-data metafields on the app installation need none either. (0.1.0 installs keep their old `write_script_tags` token only until the old ScriptTag is deleted.)
- **What the storefront widget sends:** the shopper's browser loads `https://cdn.conferbot.com/dist/v1/widget.min.js`. The loader passes the widget:
  - the Chatbot ID
  - `platform: "shopify"`, the shop domain, and the active currency
  - for a logged-in customer, the Shopify customer ID only (`shopify-<id>`), taken from the storefront page. No name or email.
- Whatever the shopper types or uploads in the chat goes to Conferbot as the conversation. The app sets no cookies of its own.

## 5. Reviewer test instructions (once hosted)

> 1. Install the app on the review store from the listing. You are taken through OAuth, then land on the Conferbot settings page inside the Shopify admin.
> 2. Click "Try our demo bot", or paste the public demo Chatbot ID `691c970890527a0468f9b2c9` (a live "Startup Consultation Chatbot"; no Conferbot account needed). Turn the chat on and save.
> 3. Click "Open the theme editor (App embeds)" (step 3). The theme editor opens with the Conferbot chat app embed switched on: click Save. (Manually: Online Store > Themes > Customize > App embeds > Conferbot chat: on > Save.)
> 4. Open the storefront. A chat bubble appears bottom right. Click it and reply to the bot.
> 5. Uninstall: the embed disappears with the app, and the shop record is deleted (`app/uninstalled`).

Fill in the test store URL and staff credentials in the review form, with full access.

## 6. Assets (in `docs/marketplace/assets/`)

| File | Size | Content |
| --- | --- | --- |
| `app-icon-1200x1200.png` | 1200x1200 | Conferbot logo (from the landing site) on white. Shopify rounds the corners. |
| `feature-media-1600x900.png` | 1600x900 | Wordmark, one line of text, and the real widget panel |
| `screenshot-1-settings-1600x900.png` | 1600x900 | The app's real settings page after saving (from the e2e recording, no browser chrome) |

**Still needed** (2–5 more, after hosting): Shopify's image rules from March 2026 require real app UI, no browser frames, no logo-only images and no personal data. Capture on a development store: (2) the theme editor App embeds toggle, (3) the chat bubble on the Dawn theme, (4) a conversation open on a product page. The storefront in `docs/demo.gif` is a mock, so it must not be used in the listing. Add alt text for every image.

## 7. Owner checklist

- [x] #7: theme app extension, App Bridge session tokens, GraphQL (0.2.0).
- [ ] Host the app: HTTPS `APP_URL`, a database for `store.js`, env vars `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `APP_URL`.
- [ ] Partner account: company details, pay the $19 registration, set the emergency contact.
- [ ] Dev Dashboard: create the app, fill the Client ID and `APP_URL` into `shopify.app.toml`, run `shopify app deploy` (URLs, webhooks, compliance webhooks, app embed), then the listing copy above.
- [ ] Create a development store, install, and capture the remaining screenshots and a short onboarding screencast.
- [ ] Pass the automated checks, then Submit for review. Answer review emails.

Owner time: about 1 day (hosting, store, screenshots, listing), plus 2–3 weeks of review. Fees: $19 once.
