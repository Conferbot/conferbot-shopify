# Web widget parity: Shopify

The widget loads its look and behaviour from the Conferbot dashboard, so a plugin only has to load it and pass the store's data. Done in this plugin:

- the loader, as the widget runs it today (`cdn.conferbot.com/dist/v1/widget.min.js`, `window.ConferbotWidget(botId, embedType, options)`)
- shop context in `options.customData`: `platform`, `shopDomain`, `storeCurrency`
- delivered by the theme app extension's app embed block (`extensions/conferbot-embed`), configured through app-data metafields
- the signed-in customer's Shopify id as `options.user.id` (`shopify-<id>`, read from the storefront's `window.__st`), unsigned
- `app/uninstalled` and the mandatory compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
- README install guide

## Left

- **Identity verification:** the customer id is not signed. The app embed's Liquid knows `customer.id`, but an HMAC user hash needs a secret the theme cannot hold, so it needs an app proxy that signs per request.
- **Customer name and email:** not sent; Liquid has them, but sending them unsigned would let anyone set them.
- **Sales tracking:** no `ConferbotWidget.track()` events (add to cart, purchase). App embeds do not run on the Thank you / Order status pages; a web pixel extension is the supported way.
