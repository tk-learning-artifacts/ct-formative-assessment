# ADR 0004: Admin role with read-only oversight

- **Status:** Accepted, 2026-09-27 (branch `feat/admin-role`). Akmal decided that a head of department can see every teacher's events, and that by default this access is read-only. The choices below that he did not specify are marked as decided here, and are open to his review.
- **Scope:** An `admin` role, how it is checked on the server and shown on the teacher page, and how accounts get it. Closes "Admin role" under "Still open" in ADR 0001. Builds on ADR 0001 §8 (teachers see only their own events) and ADR 0003 §10 (editing an event's settings).

## Context

Every account has been a teacher, scoped to the events it created (`events.created_by`). A teacher asking for another teacher's event gets 404, the same answer as for an event that does not exist, so event ids cannot be probed. `users.role` has existed since the original app and always held `teacher`, but nothing read it.

A head of department wants to see how every class is doing: each teacher's events, their results, the per-outcome summary, the settings history and each student's answers. There is no user-management UI, and this change does not add one.

## Decision

### 1. Two roles

`users.role` is `teacher` (the default) or `admin`. A migration (`202609270811-user-roles.js`) sets any other stored value to `teacher` and adds triggers that refuse anything else on insert or update, because SQLite cannot add a CHECK constraint to an existing table without rebuilding it.

An admin can:

- list every teacher's events (`GET /api/events`), each with its owner's email;
- read any event: `GET /api/events/:id/results` (the event, every attempt with its answers, the settings history), `GET /api/events/:id/outcomes-summary` and `GET /api/events/:id/questions` (the event's frozen question snapshot, full teacher views — answer key, rubric and the rest);
- create and run their own events exactly as a teacher does.

A question preview is a read of content the owner already put in front of students, not a change to the event, so it follows the same rule as results and the outcomes summary (added 2026-09-27, alongside the teacher's compact question preview in admin.html).

### 2. Other teachers' events are read-only (the default)

On an event it did not create, an admin cannot reset an attempt, release results, edit settings (`PATCH /api/events/:id`) or mark an AI-scored answer. The server answers those with **403** ("Only the teacher who created this event can change it."). The teacher page hides the Release, Edit settings and Reset buttons and the marking forms on such an event, and shows a one-line "Read only" notice naming the owner.

**Alternative: full control.** An admin could change any event as if they owned it. That suits a department where the head covers for an absent teacher: releasing results, resetting a stuck student, marking the AI answers. The trade-off is that two people can then change one event, and neither sees the other's change until they reload. The settings history records who changed a setting, but a release records no actor at all (only `results_released_at`), and a reset or a mark keeps only the actor's id in the database (`reset_by`, `detail.review.reviewedBy`), which the page does not show; it would label an admin's mark "Marked by you" on the owner's screen. A teacher might find their results released by someone else mid-lesson. Read-only keeps each event under one person's control; the head asks the teacher to make a change.

**To flip it:** make `canManage` in `backend/src/access.js` return true for an admin as well as for the owner. The teacher page reads `can_manage` from each event, so it needs no change. `test/admin-role.test.js` then fails on the "admin on a teacher's event" writes (403 expected), which is the list of tests to update. Before flipping, record and show who released, reset or marked.

### 3. Enforcement: one helper, one rule file

`backend/src/access.js` holds the rule: `eventAccess(user, event)` returns `"manage"` (the owner), `"read"` (an admin on someone else's event) or `null`. Every teacher route that takes an event id calls `eventForRequest(req, res, { manage })` in `app.js`, which loads the event and answers:

- **404** when the caller may not read it, exactly as before for a teacher (another teacher's event looks like a missing one), and for everyone when the id does not exist;
- **403** when the route changes something (`manage: true`) and the caller may only read;
- otherwise the event.

The routes that changed from `ownEvent` to `eventForRequest`: results, outcomes-summary and questions (read), and PATCH settings, release, reset and review (manage). `GET /api/events` lists every event for an admin and the caller's own for a teacher. The routes without an event id (catalog, ontology, outcomes, presets, preview, create) are the same for both roles; `POST /api/question-bank/preview` with `include: "questions"` is one of them, since it previews a selection rather than reading a specific event.

A teacher gets 404 on an admin's own events too: being an admin does not make one's events public.

The student routes (join, start, resume, the `?fields=status` poll, commit, submit) take an attempt token, not a teacher's JWT, and access.js plays no part in them. The in-order delivery, status poll and pre-release total merged alongside this role (ADR 0003) changed only those routes, so no teacher route was added or changed by them.

### 4. The role is read from the database on every request (decided here)

The JWT still carries `role`, but `requireAuth` now loads the account by id on every request and takes the role from the database. So promoting or demoting an account takes effect on its next request, not when its 7-day token expires, and a deleted account's token stops working at once (401). The cost is one primary-key lookup per teacher request.

### 5. Event responses say whose event it is

Every event the teacher routes return carries `owner_email`, `owned` (the caller created it) and `can_manage` (the caller may change it). `created_by` stays out of responses, as before. Today `owned` and `can_manage` are always equal; they are separate so the UI keeps working if section 2 is flipped.

### 6. Managing accounts from the command line

- `npm run set-role -- <email> admin|teacher` changes an existing account's role and prints the old one. It refuses an unknown email and points to `set-password`, which creates accounts. In Docker: `docker compose run --rm app node backend/scripts/set-role.js <email> admin`.
- The first account, seeded into an empty database from `SEED_TEACHER_EMAIL` and `SEED_TEACHER_PASSWORD`, is always an admin: whoever deploys the app oversees it. Every later account starts as a teacher. Roles live in `users.role`; seeding happens only on an empty database, so it cannot promote anyone later. (An earlier draft had a `SEED_TEACHER_ROLE` setting for this. It was dropped as one more setting to get wrong, after it was found missing from `docker-compose.yml`.)

### 7. The teacher page (decided here)

For an admin only, the event list is titled "Events" and has a compact filter above it: an "All teachers / Mine" toggle and, under All teachers, a teacher select listing every teacher who owns an event. Each card shows the owner's email, or "Yours". The filter works on the list already loaded and redraws only the list, so a half-filled New event form is kept. It starts on All teachers and resets on sign-out. A teacher's page is unchanged.

### 8. AI policy is unchanged

The admin role adds no path to the AI provider. The only teacher route that touches AI-scored answers is marking by hand, which is a change and therefore owner-only. Reading results never calls the provider.

### 9. The question bank is shared content, so its edits are admin-only (added 2026-09-29)

The question bank is not owned by any teacher, so the owner rules above do not apply to it. `access.js` gains `canEditBank(user)`, true for an admin. Admins alone change a question's metadata or retire and restore it (ADR 0008), because each such edit changes every teacher's future events. Any signed-in teacher may read the bank, flag a question and add a comment. The audit table `question_override_changes` records who changed what.

## Consequences

- Teachers see no difference, except that a token for a deleted account now gets 401 everywhere.
- A head of department can oversee every event without being able to disturb one in progress.
- Promoting and demoting are one command each, effective immediately.
- `users.role` can never hold a value the code does not understand.
- An admin's event list grows with the department. It is filtered in the browser, which is fine for hundreds of events; server-side paging would be the next step beyond that.
- The migration id `202609270811` uses the current UTC time as the rule requires, and sorts before three earlier migrations whose ids used Singapore time. The runner applies every unrecorded migration in id order, and this one depends only on the baseline `users` table, so existing and fresh databases both end up the same.
