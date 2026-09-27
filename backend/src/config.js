const path = require("path");

const DEFAULT_DB_PATH = path.resolve(__dirname, "../data/app.db");
const DEV_JWT_SECRET = "ct-quest-dev-secret";
const DEFAULT_TEACHER_EMAIL = "teacher@ctquest.local";
const DEFAULT_TEACHER_PASSWORD = "changeme123";

// Reads every environment setting in one place so the rest of the backend
// never touches process.env directly. Throws on settings that would make a
// production deployment unsafe.
function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";

  if (isProduction && !env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be set when NODE_ENV=production. Refusing to start with the development secret.");
  }

  const seedPassword = env.SEED_TEACHER_PASSWORD || null;

  if (isProduction && seedPassword === DEFAULT_TEACHER_PASSWORD) {
    throw new Error("SEED_TEACHER_PASSWORD must not be the demo password when NODE_ENV=production.");
  }

  const graceSeconds = env.SUBMIT_GRACE_SECONDS === undefined ? 60 : Number(env.SUBMIT_GRACE_SECONDS);

  if (!Number.isFinite(graceSeconds) || graceSeconds < 0) {
    throw new Error("SUBMIT_GRACE_SECONDS must be a non-negative number.");
  }

  const aiConcurrency = env.AI_CONCURRENCY === undefined || env.AI_CONCURRENCY === "" ? 2 : Number(env.AI_CONCURRENCY);

  if (!Number.isInteger(aiConcurrency) || aiConcurrency < 1 || aiConcurrency > 10) {
    throw new Error("AI_CONCURRENCY must be an integer from 1 to 10.");
  }

  const aiTimeoutSeconds = env.AI_TIMEOUT_SECONDS === undefined || env.AI_TIMEOUT_SECONDS === "" ? 20 : Number(env.AI_TIMEOUT_SECONDS);

  if (!Number.isFinite(aiTimeoutSeconds) || aiTimeoutSeconds <= 0 || aiTimeoutSeconds > 120) {
    throw new Error("AI_TIMEOUT_SECONDS must be a number of seconds from 1 to 120.");
  }

  return {
    nodeEnv,
    isProduction,
    port: Number(env.PORT || 3000),
    host: env.HOST || null,
    dbPath: env.DB_PATH ? path.resolve(env.DB_PATH) : DEFAULT_DB_PATH,
    jwtSecret: env.JWT_SECRET || DEV_JWT_SECRET,
    submitGraceMs: graceSeconds * 1000,
    seedTeacher: {
      email: String(env.SEED_TEACHER_EMAIL || DEFAULT_TEACHER_EMAIL).trim().toLowerCase(),
      // Null in production when unset: seeding an empty database then fails,
      // but a database that already has a teacher boots without it.
      password: seedPassword || (isProduction ? null : DEFAULT_TEACHER_PASSWORD)
    },
    ai: {
      // "none" keeps every AI feature off. See src/ai/index.js.
      provider: String(env.AI_PROVIDER || "none").trim().toLowerCase(),
      apiKey: env.AI_API_KEY || null,
      // Null means the adapter's default (src/ai/providers/openrouter.js).
      model: env.AI_MODEL || null,
      // How many answers the background job scores at once.
      concurrency: aiConcurrency,
      timeoutMs: aiTimeoutSeconds * 1000,
      // Sent as HTTP-Referer, which OpenRouter uses to name the app.
      appUrl: env.AI_APP_URL || "http://localhost"
    }
  };
}

module.exports = {
  loadConfig,
  DEFAULT_DB_PATH,
  DEFAULT_TEACHER_EMAIL,
  DEFAULT_TEACHER_PASSWORD
};
