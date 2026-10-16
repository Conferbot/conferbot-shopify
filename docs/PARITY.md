# Web widget parity: Shopify

The widget loads its look and behaviour from the Conferbot dashboard, so a plugin only has to load it and pass the store's data. Done in this plugin:

- the loader, as the widget runs it today (`cdn.conferbot.com/dist/v1/widget.min.js`, `window.ConferbotWidget(botId, embedType, options)`)
- shop context in `options.customData`: `platform`, `shopDomain`, `storeCurrency`
- the signed-in customer's Shopify id as `options.user.id` (`shopify-<id>`, read from the storefront's `window.__st`), unsigned
- `app/uninstalled` and the mandatory compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
- README install guide

## Left

- **Identity verification:** the customer id is not signed. A ScriptTag loader is static per shop, so it cannot carry a per-customer HMAC; this needs the theme app extension (Liquid knows `customer.id`) plus an app proxy or metafield for the hash. See issue #7.
- **Customer name and email:** same reason; not sent.
- **Sales tracking:** no `ConferbotWidget.track()` events (add to cart, purchase). ScriptTags do not run on the new Thank you / Order status pages; a web pixel extension is the supported way.
- **Theme app extension:** an app embed block instead of the ScriptTag for Online Store 2.0 themes (#7).
