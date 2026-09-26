const { loadConfig } = require("./config");
const { createApp } = require("./app");

let config;

try {
  config = loadConfig();
} catch (error) {
  console.error(`CT Quest cannot start: ${error.message}`);
  process.exit(1);
}

const app = createApp({ config });

app.listen(config.port, () => {
  console.log(`CT Quest server running on http://localhost:${config.port}`);
});
