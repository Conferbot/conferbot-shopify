# Web widget parity: Shopify

The widget loads its look and behaviour from the Conferbot dashboard, so a plugin only has to load it and pass the store's data. Done in this plugin:

- the loader, as the widget runs it today
- the signed-in customer as the visitor context, with the identity verification hash made server side
- sales tracking
- README setup steps

## Left

Both items are already unchecked in the README:

- **GDPR mandatory webhooks** (`customers/data_request`, `customers/redact`, `shop/redact`) in `src/server.js`: verify the HMAC, answer 200, then act. They are required before App Store review.
- **Theme app extension:** an app embed block, as an alternative to ScriptTag for Online Store 2.0 themes.
