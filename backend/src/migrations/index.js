// Migrations, tracked by name in a schema_migrations table.
//
// Rules for adding one:
// - Add a file named YYYYMMDDHHMM-<slug>.js to this folder exporting
//   { up(db, ctx) }. The file name (without .js) is the migration id. Files
//   run in sorted order; any id already in schema_migrations is skipped.
//   Timestamped names let two branches add migrations without fighting over
//   the next number; only their relative order matters, so check it on merge.
// - Never edit a migration that has shipped; write a new one.
// - up() runs inside a transaction together with its schema_migrations row,
//   so a failure leaves the database as it was.
// - Foreign keys are switched off while migrations run (SQLite ignores that
//   pragma inside a transaction, so the runner does it outside) and checked
//   with foreign_key_check before each commit. That makes table rebuilds safe.
// - ctx.content is the validated content from backend/content, for
//   migrations that need to look up questions (for example, tag backfill).
//
// Databases made by the original code have no schema_migrations table and
// report PRAGMA user_version 0; they upgrade from the baseline like a fresh
// database (the baseline is all IF NOT EXISTS).

const fs = require("fs");
const path = require("path");

const ID_PATTERN = /^\d{12}-[a-z0-9-]+$/;

function loadMigrations(dir = __dirname) {
  return fs.readdirSync(dir)
    .filter(name => name.endsWith(".js") && name !== "index.js")
    .sort()
    .map(name => {
      const id = path.basename(name, ".js");

      if (!ID_PATTERN.test(id)) {
        throw new Error(`Migration file "${name}" must be named YYYYMMDDHHMM-<slug>.js`);
      }

      const migration = require(path.join(dir, name));

      if (typeof migration.up !== "function") {
        throw new Error(`Migration ${id} must export up(db, ctx)`);
      }

      return { id, up: migration.up };
    });
}

const MIGRATIONS = loadMigrations();
const LATEST_ID = MIGRATIONS[MIGRATIONS.length - 1].id;

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function appliedIds(db) {
  if (!tableExists(db, "schema_migrations")) {
    return [];
  }

  return db.prepare("SELECT id FROM schema_migrations ORDER BY id").all().map(row => row.id);
}

// Copies the database next to itself before upgrading one that already holds
// data, so a bad migration in production can be rolled back by swapping files.
function backupBeforeMigrating(db, dbPath, lastApplied) {
  if (!dbPath || dbPath === ":memory:") {
    return null;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const parsed = path.parse(dbPath);
  const from = lastApplied ? lastApplied.slice(0, 12) : "v1";
  const backupPath = path.join(parsed.dir, `${parsed.name}.pre-${LATEST_ID.slice(0, 12)}-from-${from}-${stamp}.db`);

  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  return backupPath;
}

function migrate(db, { dbPath = null, ctx = {}, log = () => {}, migrations = MIGRATIONS } = {}) {
  const hasTracking = tableExists(db, "schema_migrations");
  const userVersion = db.pragma("user_version", { simple: true });

  if (!hasTracking && userVersion !== 0) {
    throw new Error(
      `Database reports user_version ${userVersion} but has no schema_migrations table. ` +
      "It was made by an unreleased pre-review build of this branch; delete it and start again."
    );
  }

  const applied = appliedIds(db);
  const known = new Set(migrations.map(migration => migration.id));
  const unknown = applied.filter(id => !known.has(id));

  if (unknown.length) {
    throw new Error(`Database has migrations this code does not know (${unknown.join(", ")}). It is newer than this code; refusing to run.`);
  }

  const done = new Set(applied);
  const pending = migrations.filter(migration => !done.has(migration.id));

  if (!pending.length) {
    return { applied: [], backupPath: null };
  }

  const backupPath = tableExists(db, "users") ? backupBeforeMigrating(db, dbPath, applied[applied.length - 1]) : null;

  if (backupPath) {
    log(`Backed up database to ${backupPath} before migrating`);
  }

  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const record = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");

  db.pragma("foreign_keys = OFF");

  try {
    pending.forEach(migration => {
      db.transaction(() => {
        migration.up(db, ctx);

        const problems = db.pragma("foreign_key_check");
        if (problems.length) {
          throw new Error(`Migration ${migration.id} broke foreign keys: ${JSON.stringify(problems.slice(0, 5))}`);
        }

        record.run(migration.id, new Date().toISOString());
      })();

      log(`Applied migration ${migration.id}`);
    });
  } finally {
    db.pragma("foreign_keys = ON");
  }

  return {
    applied: pending.map(migration => migration.id),
    backupPath
  };
}

module.exports = {
  migrate,
  loadMigrations,
  appliedIds,
  MIGRATIONS,
  LATEST_ID
};
