'use strict';

const cfg = require('./config');
const createApp = require('./server');

const { app } = createApp(cfg);

app.listen(cfg.port, () => {
  console.log(`conferbot-shopify listening on :${cfg.port} (app url: ${cfg.appUrl})`);
});
