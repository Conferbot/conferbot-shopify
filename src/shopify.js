'use strict';

const crypto = require('crypto');

/**
 * Shopify OAuth + REST helpers. Pure functions where possible so they are
 * unit-testable without network access.
 */

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function isValidShopDomain(shop) {
  return SHOP_RE.test(String(shop || ''));
}

/**
 * Verifies the hmac query parameter Shopify appends to OAuth redirects:
 * remove hmac/signature, sort remaining params, join with &, HMAC-SHA256
 * with the app secret, timing-safe hex compare.
 */
function verifyHmac(query, secret) {
  const { hmac } = query;
  if (!hmac || typeof hmac !== 'string') {
    return false;
  }
  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${Array.isArray(query[k]) ? query[k].join(',') : query[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(hmac, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function buildAuthorizeUrl({ shop, apiKey, scopes, redirectUri, state, adminBase }) {
  const base = adminBase.replace('{shop}', shop);
  const params = new URLSearchParams({
    client_id: apiKey,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });
  return `${base}/admin/oauth/authorize?${params}`;
}

async function exchangeCodeForToken({ shop, code, apiKey, apiSecret, adminBase }) {
  const base = adminBase.replace('{shop}', shop);
  const res = await fetch(`${base}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('token exchange returned no access_token');
  }
  return data.access_token;
}

/**
 * Idempotently ensures a ScriptTag pointing at our widget loader exists.
 * Returns the script tag id.
 */
async function ensureScriptTag({ shop, accessToken, src, apiVersion, adminBase }) {
  const base = adminBase.replace('{shop}', shop);
  const api = `${base}/admin/api/${apiVersion}/script_tags.json`;
  const headers = {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json',
  };

  const listRes = await fetch(api, { headers });
  if (!listRes.ok) {
    throw new Error(`script tag list failed: HTTP ${listRes.status}`);
  }
  const existing = (await listRes.json()).script_tags || [];
  const ours = existing.find((t) => t.src === src);
  if (ours) {
    return ours.id;
  }

  const createRes = await fetch(api, {
    method: 'POST',
    headers,
    body: JSON.stringify({ script_tag: { event: 'onload', src } }),
  });
  if (!createRes.ok) {
    throw new Error(`script tag create failed: HTTP ${createRes.status}`);
  }
  return (await createRes.json()).script_tag.id;
}

module.exports = {
  isValidShopDomain,
  verifyHmac,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  ensureScriptTag,
};
