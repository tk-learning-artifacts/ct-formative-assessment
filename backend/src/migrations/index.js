// Versioned migrations keyed on SQLite's PRAGMA user_version.
//
// Rules for adding one:
// - Add a file NNN-name.js exporting { version, name, up(db) } and append it
//   to MIGRATIONS. Versions are consecutive integers. Never edit a migration
//   that has shipped; write a new one.
// - up() runs inside a transaction together with the user_version bump, so a
//   failure leaves the database at the previous version.
// - Foreign keys are switched off while migrations run (SQLite ignores that
//   pragma inside a transaction, so the runner does it outside) and checked
//   with foreign_key_check before each commit. That makes table rebuilds safe.
// - Two branches that each add migration N must renumber one of them when
//   they merge.

const fs = require("fs");
const path = require("path");

const MIGRATIONS = [
  require("./001-baseline"),
  require("./002-platform-core"),
  require("./003-fix-answer-keys")
];

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

MIGRATIONS.forEach((migration, index) => {
  if (migration.version !== index + 1) {
    throw new Error(`Migration ${migration.name} has version ${migration.version}, expected ${index + 1}`);
  }
});

function getVersion(db) {
  return db.pragma("user_version", { simple: true });
}

function hasExistingData(db) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get());
}

// Copies the database next to itself before upgrading one that already holds
// data, so a bad migration in production can be rolled back by swapping files.
function backupBeforeMigrating(db, dbPath, fromVersion) {
  if (!dbPath || dbPath === ":memory:") {
    return null;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const parsed = path.parse(dbPath);
  const backupPath = path.join(parsed.dir, `${parsed.name}.pre-v${LATEST_VERSION}-from-v${fromVersion}-${stamp}.db`);

  if (fs.existsSync(backupPath)) {
    return backupPath;
  }

  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  return backupPath;
}

function migrate(db, { dbPath = null, log = () => {} } = {}) {
  const current = getVersion(db);

  if (current > LATEST_VERSION) {
    throw new Error(`Database is at version ${current}, newer than this code (${LATEST_VERSION}). Refusing to run.`);
  }

  const pending = MIGRATIONS.filter(migration => migration.version > current);

  if (!pending.length) {
    return { from: current, to: current, applied: [], backupPath: null };
  }

  const backupPath = hasExistingData(db) ? backupBeforeMigrating(db, dbPath, current) : null;

  if (backupPath) {
    log(`Backed up database to ${backupPath} before migrating from v${current}`);
  }

  db.pragma("foreign_keys = OFF");

  try {
    pending.forEach(migration => {
      db.transaction(() => {
        migration.up(db);

        const problems = db.pragma("foreign_key_check");
        if (problems.length) {
          throw new Error(`Migration ${migration.version} (${migration.name}) broke foreign keys: ${JSON.stringify(problems.slice(0, 5))}`);
        }

        db.pragma(`user_version = ${migration.version}`);
      })();

      log(`Applied migration ${migration.version} (${migration.name})`);
    });
  } finally {
    db.pragma("foreign_keys = ON");
  }

  return {
    from: current,
    to: getVersion(db),
    applied: pending.map(migration => migration.version),
    backupPath
  };
}

module.exports = {
  migrate,
  getVersion,
  MIGRATIONS,
  LATEST_VERSION
};
