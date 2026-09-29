// Deletes an event, with its questions, every attempt and answer, and its
// settings history. There is no button for this on the teacher page, because
// the results are gone for good.
//
//   npm run delete-event -- RGSYN2            shows what would be deleted
//   npm run delete-event -- RGSYN2 --yes      deletes it
//   docker compose exec app node backend/scripts/delete-event.js RGSYN2 --yes
//
// The event is found by its join code. A seeded event (content/seeded-events.json)
// comes back on the next start if its join code is free, so remove it from that
// file as well if it should stay gone. Take a copy of the database file first:
// there is no undo.

const { loadConfig } = require("../src/config");
const { openDatabase } = require("../src/db");

function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--yes");
  const codes = args.filter(arg => !arg.startsWith("--"));

  if (codes.length !== 1 || args.some(arg => arg.startsWith("--") && arg !== "--yes")) {
    throw new Error("Usage: npm run delete-event -- <join code> [--yes]");
  }

  const joinCode = codes[0].trim().toUpperCase();
  // As in set-role.js, the seed and production checks are not relevant.
  const config = loadConfig({ ...process.env, NODE_ENV: "development" });
  const store = openDatabase({ dbPath: config.dbPath, seedTeacher: null, isProduction: false });

  try {
    const event = store.db.prepare(`
      SELECT e.id, e.title, e.join_code, u.email AS owner,
             (SELECT COUNT(*) FROM event_questions q WHERE q.event_id = e.id) AS questions,
             (SELECT COUNT(*) FROM attempts a WHERE a.event_id = e.id) AS attempts,
             (SELECT COUNT(*) FROM attempts a WHERE a.event_id = e.id AND a.reset_at IS NULL) AS live_attempts
      FROM events e LEFT JOIN users u ON u.id = e.created_by
      WHERE e.join_code = ?
    `).get(joinCode);

    if (!event) {
      throw new Error(`No event has the join code ${joinCode}.`);
    }

    const summary = `"${event.title}" (${event.join_code}), owned by ${event.owner || "nobody"}: ${event.questions} questions, ${event.attempts} attempts (${event.live_attempts} not reset)`;

    if (!confirmed) {
      console.log(`Would delete ${summary}.\nRun again with --yes to delete it.`);
      return;
    }

    const result = store.deleteEvent(event.id);
    console.log(`Deleted ${summary}. ${result.removed} event removed.`);
  } finally {
    store.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
