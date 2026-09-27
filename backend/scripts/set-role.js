// Sets an existing account's role (ADR 0004).
//
//   npm run set-role -- head@school.edu.sg admin
//   npm run set-role -- head@school.edu.sg teacher
//   docker compose exec app node backend/scripts/set-role.js head@school.edu.sg admin
//
// An admin can read every teacher's events; a teacher sees only their own.
// The account must already exist: create it with `npm run set-password`
// first. The change applies from the account's next request, because the
// server reads the role from the database rather than from the sign-in token.

const { loadConfig } = require("../src/config");
const { openDatabase } = require("../src/db");
const { ROLES } = require("../src/access");

function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  const role = String(process.argv[3] || "").trim().toLowerCase();

  if (!email || !email.includes("@") || !ROLES.includes(role) || process.argv.length > 4) {
    throw new Error(`Usage: npm run set-role -- <email> <${ROLES.join("|")}>`);
  }

  // As in set-password.js, the seed and production checks are not relevant.
  const config = loadConfig({ ...process.env, NODE_ENV: "development" });
  const store = openDatabase({ dbPath: config.dbPath, seedTeacher: null, isProduction: false });

  try {
    const previous = store.setRole(email, role);

    if (previous === null) {
      throw new Error(`No account for ${email} in ${config.dbPath}. Create it with \`npm run set-password -- ${email}\` first.`);
    }

    console.log(previous === role
      ? `${email} is already ${role} in ${config.dbPath}.`
      : `Set ${email} to ${role} (was ${previous}) in ${config.dbPath}.`);
  } finally {
    store.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
