const { loadConfig } = require("./config");
const { createApp } = require("./app");

let app;
let config;

try {
  config = loadConfig();
  app = createApp({ config });
} catch (error) {
  console.error(`CT Quest cannot start: ${error.message}`);
  process.exit(1);
}

// HOST is optional: unset listens on every interface (what Docker needs);
// HOST=127.0.0.1 keeps a local run private to this machine.
const onListening = () => {
  console.log(`CT Quest server running on http://${config.host || "localhost"}:${config.port}`);
};

if (config.host) {
  app.listen(config.port, config.host, onListening);
} else {
  app.listen(config.port, onListening);
}
