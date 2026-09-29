# ADR 0009: Events seeded from content

- **Status:** Accepted, 2026-09-29. Akmal asked for a hand-picked 20-question RGSynapse event that is part of the database from a deploy, half multiple choice and harder than the general mix. The choices below that he did not specify are decided here and open to his review.
- **Scope:** How an event comes to exist on every server without a teacher creating it, and how one is removed. Builds on ADR 0001 (events and the question snapshot), ADR 0003 §10 (editing an event) and ADR 0004 (owners).

## Decision

**1. Seeded events are content, in `backend/content/seeded-events.json`.** Each entry has an id, title, join code, audience, a list of question ids, and optionally a time limit and the feedback and navigation modes. The list is the order students see: a seeded event sets its own order instead of the bank's, which would put every multiple-choice question first. The content check refuses an unknown or duplicate question, a question from another audience, a join code that is not 4 to 12 characters of the join-code alphabet, or a repeated code.

**2. They are created on every start, if absent.** `ensureSeededEvents` in `src/db.js` runs after the demo event, and creates each entry whose join code has no event yet, owned by the first admin (or the first account), through the same code as a teacher-made event. A server deployed later gets an event added to the file on its next start. Nothing is created before an account exists to own it. An event that exists is never touched, so a teacher who renames it or changes its time limit keeps their edits. The alternative was a migration per event: it runs once per database, so a database that has already run it can never receive a corrected event, and it would put content in the code.

**3. Retired questions and boot.** A question retired in the bank (ADR 0008) is left out of a seeded event when it is created, rather than stopping start-up, for the reason retirements never stop start-up.

**4. `SEED_EVENTS=false` turns it off**, for a server that wants only its own events. The migration tests set it, because they open old databases and count their events.

**5. Removing an event is a script, not a route.** `scripts/delete-event.js <join code> [--yes]` shows what it would delete (questions, attempts, live attempts) and deletes only with `--yes`. It removes the event, its question snapshot, its attempts, their answers and its settings history. It is not on the teacher page because the results go with it. A seeded event comes back if its join code is free on the next start, so removing it for good also means removing it from the file.

## Consequences

- The RGSynapse challenge (`RGSYN2`) is in every database from its next start: 20 questions, 10 multiple choice, difficulty 3 and 4 only, Sec 1 and Sec 2, none AI scored, so every answer is marked at once.
- Its questions are frozen into the event when it is created. Editing the file later does not change an existing event; the teacher's "Change questions" does (while no attempt is live).
- The join code cannot be changed after an event is created (ADR 0003 §10), so a code in the file is chosen once.
