const path = require("path");

const DEFAULT_DB_PATH = path.resolve(__dirname, "../data/app.db");
const DEV_JWT_SECRET = "ct-quest-dev-secret";

// Reads every environment setting in one place so the rest of the backend
// never touches process.env directly. Throws on settings that would make a
// production deployment unsafe.
function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";

  if (isProduction && !env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be set when NODE_ENV=production. Refusing to start with the development secret.");
  }

  const graceSeconds = env.SUBMIT_GRACE_SECONDS === undefined ? 60 : Number(env.SUBMIT_GRACE_SECONDS);

  if (!Number.isFinite(graceSeconds) || graceSeconds < 0) {
    throw new Error("SUBMIT_GRACE_SECONDS must be a non-negative number.");
  }

  return {
    nodeEnv,
    isProduction,
    port: Number(env.PORT || 3000),
    dbPath: env.DB_PATH ? path.resolve(env.DB_PATH) : DEFAULT_DB_PATH,
    jwtSecret: env.JWT_SECRET || DEV_JWT_SECRET,
    submitGraceMs: graceSeconds * 1000,
    ai: {
      // "none" keeps every AI feature off. See src/ai/index.js.
      provider: String(env.AI_PROVIDER || "none").trim().toLowerCase(),
      apiKey: env.AI_API_KEY || null,
      model: env.AI_MODEL || null
    }
  };
}

module.exports = {
  loadConfig,
  DEFAULT_DB_PATH
};
