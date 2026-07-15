'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tiny JSON-file store for per-shop state: { [shopDomain]: { accessToken,
 * botId, enabled, scriptTagId } }. Deliberately dependency-free; swap for
 * Redis/Postgres behind the same four functions when going multi-instance.
 */
class ShopStore {
  constructor(file) {
    this.file = file;
    this.shops = {};
    this.load();
  }

  load() {
    try {
      this.shops = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      this.shops = {};
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.shops, null, 2));
  }

  get(shop) {
    return this.shops[shop] || null;
  }

  upsert(shop, patch) {
    this.shops[shop] = Object.assign({}, this.shops[shop], patch);
    this.persist();
    return this.shops[shop];
  }

  remove(shop) {
    delete this.shops[shop];
    this.persist();
  }
}

module.exports = ShopStore;
