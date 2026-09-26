const crypto = require("crypto");

// Password hashes are stored as "scrypt$<salt hex>$<hash hex>" with a fresh
// random salt per user. The original code used one fixed salt for everyone
// and stored a bare 128-character hex hash; those still verify so existing
// teachers can log in, and the login route rehashes them into the new format.
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const LEGACY_SALT = "ct-quest-salt";
const LEGACY_HASH = /^[0-9a-f]{128}$/;

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function safeEqual(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Returns { ok, needsRehash }.
function verifyPassword(password, stored) {
  const value = String(stored || "");

  if (value.startsWith("scrypt$")) {
    const [, saltHex, hashHex] = value.split("$");

    if (!saltHex || !hashHex) {
      return { ok: false, needsRehash: false };
    }

    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length);
    return { ok: safeEqual(actual, expected), needsRehash: false };
  }

  if (LEGACY_HASH.test(value)) {
    const expected = Buffer.from(value, "hex");
    const actual = crypto.scryptSync(String(password), LEGACY_SALT, SCRYPT_KEYLEN);
    const ok = safeEqual(actual, expected);
    return { ok, needsRehash: ok };
  }

  return { ok: false, needsRehash: false };
}

// Attempt tokens: 32 random bytes handed to the student's browser when an
// attempt starts. Only a SHA-256 digest is stored, so a leaked database does
// not let anyone submit on a student's behalf.
function createAttemptToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashAttemptToken(token) };
}

function hashAttemptToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function verifyAttemptToken(token, storedHash) {
  if (!token || !storedHash) {
    return false;
  }

  return safeEqual(Buffer.from(hashAttemptToken(token), "hex"), Buffer.from(storedHash, "hex"));
}

module.exports = {
  hashPassword,
  verifyPassword,
  createAttemptToken,
  hashAttemptToken,
  verifyAttemptToken
};
