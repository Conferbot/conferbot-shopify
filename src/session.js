'use strict';

const crypto = require('crypto');

/**
 * Short-lived tokens that tie a settings page (and its save) to one shop.
 *
 * The admin page used to trust a bare ?shop= parameter, so anyone could open
 * or save any store's settings and point its chat at their own bot. Now the
 * page opens only from Shopify's signed admin launch (or right after the
 * install), and the form carries a token signed with the app secret that the
 * save checks.
 *
 * Token: base64url("<shop>|<expiry ms>") + "." + hex HMAC-SHA256 of that part.
 */

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64url = (s) => Buffer.from(s, 'base64url').toString('utf8');

function sign(part, secret) {
  return crypto.createHmac('sha256', secret).update(part).digest('hex');
}

function issueToken(shop, secret, ttlMs = 60 * 60 * 1000, now = Date.now()) {
  const part = b64url(`${shop}|${now + ttlMs}`);
  return `${part}.${sign(part, secret)}`;
}

/** True when the token was issued by us for this shop and has not expired. */
function verifyToken(token, shop, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const part = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const want = Buffer.from(sign(part, secret), 'utf8');
  const got = Buffer.from(mac, 'utf8');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return false;
  let decoded;
  try {
    decoded = unb64url(part);
  } catch (_) {
    return false;
  }
  const bar = decoded.lastIndexOf('|');
  if (bar < 1) return false;
  const tokenShop = decoded.slice(0, bar);
  const exp = Number(decoded.slice(bar + 1));
  return tokenShop === shop && Number.isFinite(exp) && exp > now;
}

/**
 * Shopify's admin launch: the app URL carries hmac + timestamp signed with the
 * app secret. Fresh within a day (Shopify signs every load).
 */
function isFreshLaunch(query, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000) {
  const ts = Number(query && query.timestamp) * 1000;
  return Number.isFinite(ts) && Math.abs(now - ts) <= maxAgeMs;
}

module.exports = { issueToken, verifyToken, isFreshLaunch };
