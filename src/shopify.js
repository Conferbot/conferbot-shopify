'use strict';

const crypto = require('crypto');

/**
 * Shopify helpers: token exchange, GraphQL Admin API, app-data metafields,
 * legacy ScriptTag cleanup, webhook HMAC and the theme editor deep link.
 * Pure functions where possible so they are unit-testable without network
 * access; everything that talks to Shopify takes `adminBase` so tests can
 * point it at a mock.
 */

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

// Namespace of the app-data metafields the theme app extension reads
// (app.metafields.conferbot.<key> in blocks/conferbot-embed.liquid).
const METAFIELD_NAMESPACE = 'conferbot';

function isValidShopDomain(shop) {
  return SHOP_RE.test(String(shop || ''));
}

const baseFor = (adminBase, shop) => adminBase.replace('{shop}', shop);

/**
 * Exchanges an App Bridge session token for an expiring offline access token
 * (new public apps may not use non-expiring ones). Returns
 * { accessToken, expiresAt, scope }.
 */
async function exchangeToken({ shop, idToken, apiKey, apiSecret, adminBase, now = Date.now() }) {
  const res = await fetch(`${baseFor(adminBase, shop)}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: idToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
      expiring: '1',
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('token exchange returned no access_token');
  }
  const expiresIn = Number(data.expires_in);
  return {
    accessToken: data.access_token,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : null,
    scope: data.scope || '',
  };
}

/** One GraphQL Admin API call. Throws on HTTP or top-level GraphQL errors. */
async function graphql({ shop, accessToken, query, variables, apiVersion, adminBase }) {
  const res = await fetch(`${baseFor(adminBase, shop)}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL request failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  if (Array.isArray(body.errors) && body.errors.length) {
    throw new Error(`GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  return body.data || {};
}

const APP_INSTALLATION_QUERY = 'query ConferbotAppInstallation { currentAppInstallation { id } }';

const METAFIELDS_SET_MUTATION = `mutation ConferbotSaveSettings($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { key namespace }
    userErrors { field message code }
  }
}`;

async function getAppInstallationId(opts) {
  const data = await graphql({ ...opts, query: APP_INSTALLATION_QUERY });
  const id = data.currentAppInstallation && data.currentAppInstallation.id;
  if (!id) {
    throw new Error('currentAppInstallation returned no id');
  }
  return id;
}

/**
 * The metafields the app embed reads. All four are written on every save so
 * the storefront never sees a half-updated set.
 */
function settingsMetafields(ownerId, { botId, enabled, embedType, scriptUrl }) {
  const field = (key, type, value) => ({ ownerId, namespace: METAFIELD_NAMESPACE, key, type, value });
  return [
    field('bot_id', 'single_line_text_field', botId || ''),
    field('enabled', 'boolean', enabled ? 'true' : 'false'),
    field('embed_type', 'single_line_text_field', embedType === 'popup_chat' ? 'popup_chat' : 'live_chat'),
    field('script_url', 'url', scriptUrl),
  ];
}

/**
 * Writes the widget settings as app-data metafields on the app installation
 * (Shopify's pattern for data a theme app extension reads; hidden from the
 * admin, no access scope needed). Returns the installation id so callers can
 * cache it.
 */
async function saveSettingsMetafields({ shop, accessToken, apiVersion, adminBase, appInstallationId, settings }) {
  const opts = { shop, accessToken, apiVersion, adminBase };
  const ownerId = appInstallationId || await getAppInstallationId(opts);
  const data = await graphql({
    ...opts,
    query: METAFIELDS_SET_MUTATION,
    variables: { metafields: settingsMetafields(ownerId, settings) },
  });
  const errors = (data.metafieldsSet && data.metafieldsSet.userErrors) || [];
  if (errors.length) {
    throw new Error(`metafieldsSet: ${errors.map((e) => e.message).join('; ')}`);
  }
  return ownerId;
}

const SCRIPT_TAGS_QUERY = `query ConferbotScriptTags($after: String) {
  scriptTags(first: 50, after: $after) {
    nodes { id src }
    pageInfo { hasNextPage endCursor }
  }
}`;

const SCRIPT_TAG_DELETE_MUTATION = `mutation ConferbotScriptTagDelete($id: ID!) {
  scriptTagDelete(id: $id) {
    deletedScriptTagId
    userErrors { field message }
  }
}`;

/**
 * Cleanup for shops installed with 0.1.0: deletes the ScriptTags that pointed
 * at this app's /script.js loader. The app never creates ScriptTags any more
 * (scriptTagCreate is refused since 1 Oct 2026); reading and deleting keep
 * working. `scriptTags` only returns tags owned by this app. Returns the
 * number of tags deleted.
 */
async function deleteLegacyScriptTags({ shop, accessToken, apiVersion, adminBase }) {
  const opts = { shop, accessToken, apiVersion, adminBase };
  const ours = [];
  let after = null;
  for (let page = 0; page < 10; page++) {
    const data = await graphql({ ...opts, query: SCRIPT_TAGS_QUERY, variables: { after } });
    const conn = data.scriptTags || { nodes: [], pageInfo: {} };
    for (const tag of conn.nodes || []) {
      if (/\/script\.js\?shop=/.test(String(tag.src || ''))) ours.push(tag.id);
    }
    if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  for (const id of ours) {
    const data = await graphql({ ...opts, query: SCRIPT_TAG_DELETE_MUTATION, variables: { id } });
    const errors = (data.scriptTagDelete && data.scriptTagDelete.userErrors) || [];
    if (errors.length) {
      throw new Error(`scriptTagDelete: ${errors.map((e) => e.message).join('; ')}`);
    }
  }
  return ours.length;
}

/**
 * Theme editor link that opens App embeds with Conferbot selected and
 * switched on: /admin/themes/current/editor?context=apps&activateAppId={api_key}/{handle}
 */
function themeEditorEmbedUrl(shop, apiKey, handle) {
  const params = new URLSearchParams({ context: 'apps', activateAppId: `${apiKey}/${handle}` });
  return `https://${shop}/admin/themes/current/editor?${params}`;
}

/**
 * Verifies a webhook: X-Shopify-Hmac-Sha256 is the base64 HMAC-SHA256 of the
 * raw request body with the app secret. Must be checked against the exact
 * bytes received, before any JSON parsing.
 */
function verifyWebhookHmac(rawBody, hmacHeader, secret) {
  if (!secret || typeof hmacHeader !== 'string' || !hmacHeader || !Buffer.isBuffer(rawBody)) {
    return false;
  }
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(hmacHeader, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  METAFIELD_NAMESPACE,
  isValidShopDomain,
  exchangeToken,
  graphql,
  settingsMetafields,
  saveSettingsMetafields,
  deleteLegacyScriptTags,
  themeEditorEmbedUrl,
  verifyWebhookHmac,
};
