'use strict';

const crypto = require('crypto');

/**
 * App Bridge session tokens (Shopify calls them ID tokens).
 *
 * The embedded settings page asks App Bridge for a token (`shopify.idToken()`)
 * and sends it as `Authorization: Bearer <token>` on every call to this app.
 * It is a JWT signed HS256 with the app's client secret. Per shopify.dev
 * (Authentication > ID tokens) the backend must check:
 *   - the signature (HS256, client secret)
 *   - exp in the future, nbf in the past
 *   - aud equals the app's client ID
 *   - iss and dest have the same hostname
 * The shop is the dest hostname, so a token can only ever act for its own shop.
 */

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
// Small allowance for clock drift between Shopify and this server.
const LEEWAY_SEC = 5;

function hostOf(url) {
  try {
    return new URL(String(url)).hostname;
  } catch (_) {
    return '';
  }
}

function parseJson(b64) {
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} token the bearer JWT
 * @param {{ apiKey: string, apiSecret: string, now?: number }} opts
 * @returns {{ shop: string, payload: object } | null} null when invalid
 */
function verifySessionToken(token, { apiKey, apiSecret, now = Date.now() }) {
  if (typeof token !== 'string' || !apiKey || !apiSecret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  const header = parseJson(h);
  if (!header || header.alg !== 'HS256') return null;

  const want = crypto.createHmac('sha256', apiSecret).update(`${h}.${p}`).digest();
  let got;
  try {
    got = Buffer.from(s, 'base64url');
  } catch (_) {
    return null;
  }
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;

  const payload = parseJson(p);
  if (!payload) return null;
  const nowSec = Math.floor(now / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp + LEEWAY_SEC <= nowSec) return null;
  if (!Number.isFinite(payload.nbf) || payload.nbf - LEEWAY_SEC > nowSec) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(apiKey)) return null;

  const shop = hostOf(payload.dest);
  if (!SHOP_RE.test(shop) || hostOf(payload.iss) !== shop) return null;
  return { shop, payload };
}

/** Pulls the token out of `Authorization: Bearer <token>`. */
function bearerToken(header) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header || ''));
  return m ? m[1] : '';
}

module.exports = { verifySessionToken, bearerToken };
