// Sets a teacher's password, creating the account if it does not exist.
//
//   npm run set-password -- teacher@school.edu.sg
//   docker compose exec app node backend/scripts/set-password.js teacher@school.edu.sg
//
// The password is never taken from the command line (it would end up in shell
// history and process listings). It is read from the NEW_PASSWORD environment
// variable if set, otherwise from standard input: typed at a hidden prompt on
// a terminal, or piped in (the first line is used).

const { loadConfig, DEFAULT_TEACHER_PASSWORD } = require("../src/config");
const { openDatabase } = require("../src/db");

const MIN_LENGTH = 10;

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";

    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function onData(chunk) {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stderr.write("\n");
          resolve(value);
          return;
        }

        if (char === "\u0003") {
          stdin.setRawMode(false);
          reject(new Error("Cancelled."));
          return;
        }

        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    }

    stdin.on("data", onData);
  });
}

function readPiped() {
  return new Promise(resolve => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { data += chunk; });
    process.stdin.on("end", () => resolve(data.split(/\r?\n/)[0]));
  });
}

async function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase();

  if (!email || !email.includes("@") || process.argv.length > 3) {
    throw new Error("Usage: npm run set-password -- <email>   (password from NEW_PASSWORD or stdin, never an argument)");
  }

  let password = process.env.NEW_PASSWORD;

  if (password === undefined) {
    if (process.stdin.isTTY) {
      password = await readHidden(`New password for ${email}: `);
      const again = await readHidden("Repeat it: ");
      if (again !== password) {
        throw new Error("The two passwords do not match.");
      }
    } else {
      password = await readPiped();
    }
  }

  if (!password || password.length < MIN_LENGTH) {
    throw new Error(`The password must be at least ${MIN_LENGTH} characters.`);
  }

  if (password === DEFAULT_TEACHER_PASSWORD) {
    throw new Error("That is the demo password. Choose another.");
  }

  // The seed and production checks are not relevant here: this script is how
  // an operator clears a default password before starting in production.
  const config = loadConfig({ ...process.env, NODE_ENV: "development" });
  const store = openDatabase({ dbPath: config.dbPath, seedTeacher: null, isProduction: false });

  try {
    const outcome = store.setPassword(email, password);
    console.log(`${outcome === "created" ? "Created" : "Updated"} ${email} in ${config.dbPath}.`);
  } finally {
    store.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
