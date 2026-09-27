---
title: Changing the rules of a test while students are taking it
date: 2026-09-27
project: CT Quest
tags: [live-settings, audit-log, policy, polling, state-reconciliation]
status: unread
---

# Changing the rules of a test while students are taking it

Think of a referee changing a rule at half time. Goals already scored stay scored. The new rule covers play from the restart, and the players need to hear about it before they next touch the ball. The scoreboard keeps a note of what changed and when, so nobody argues about it afterwards. CT Quest now lets a teacher change a test's settings while students are in the middle of it, and each part of that picture has a counterpart in the code.

## What we built

A teacher can open "Edit settings" on an event's results page and change the title, the feedback timing (after each question, at the end, or when released), the navigation (free, or in order), the time limit, the opening time and the deadline. The request is a PATCH to the event, and only the teacher who owns the event can make it. The one thing that cannot change is the set of questions, because every stored answer points at a question in the event's frozen snapshot. Swapping questions under a half-finished attempt would leave answers pointing at questions the student never saw.

Most of the work is making the new rules take effect without rewriting anything that already happened. There are three techniques.

The first is **deciding at read time, not at write time**. Everything a student may see goes through one file, the policy module. It is handed the event as it is right now, not a copy taken when the attempt started. So when a teacher loosens feedback from "when released" to "at the end", no migration runs over the answers. The next time a submitted student's page asks for their result, the policy module sees the new mode and includes the breakdown. Tightening works the same way in reverse. Switch "after each question" back to "when released" and the committed answers are still stored, still locked, but their correctness and the answer key simply stop appearing in responses. The cost is that the policy module runs on every request. The benefit is that no student's data needs to be touched, and no code path can show a key the current rule forbids, because nothing but the policy module decides.

The second is **a small set of facts that never move**. A committed answer is final under every setting. The commit endpoint refuses a second commit, and submit keeps committed rows whatever it is sent. Because that rule does not depend on the mode, no change of mode can unlock anything. The one place state is recomputed is the attempt deadline: when the time limit or deadline changes, each attempt still in progress gets a new deadline, the earlier of its start plus the limit and the event deadline, the same rule as at start. If the new deadline has already passed, nothing is thrown away. The student's next check is refused as time is up, their page submits, and the server stores the submission and flags it late under the existing grace window.

The third is **telling the browser**. The server cannot push to the student's page, so the page asks. It re-reads its attempt after every move between questions and every 30 seconds, compares what it got with what it is showing, and redraws only if something visible changed. That last check matters: redrawing a question wipes the cursor position in a text box, so a mark arriving for another question should not interrupt someone mid-sentence. If the deadline changed, the countdown restarts. For 40 students, a 30 second poll is under two small requests a second, which SQLite handles without noticing.

One transition needed the browser to do real work. Under free navigation, answers live in the browser until submit. When the teacher switches to in order, the server only accepts the first uncommitted question next. So the page moves the student to their first unanswered question and commits the answers before it, one by one, in order. As a safety net, the server remembers (from the audit table) that this attempt ran under free navigation, and at submit accepts every uncommitted answer rather than only the current question's, in case the page went offline before it caught up.

## Why this way, and the alternatives

The obvious alternative is to freeze settings per attempt: copy the modes onto each attempt at start, so a change only affects students who start later. That is simpler to reason about and avoids every transition rule above. It was rejected because the usual reason to change a setting is that something is going wrong now. A teacher who realises the key is leaking under "after each question" needs it to stop for the students currently working, not for tomorrow's class.

A second alternative is to push changes over a WebSocket or Server-Sent Events. That gives instant updates but adds a long-lived connection per student, reconnection logic, and a second path for state to arrive by. Polling reuses the resume endpoint that already exists, so there is one path. It is worth switching when changes must land in seconds, or the class is in the thousands.

The audit table is the scoreboard note: one row per field that actually changed, with who, when, and old and new values as text. It is append-only and shown on the results page. It also answers questions the code needs, such as whether an attempt started before navigation stopped being free.

## Glossary

- **PATCH:** the HTTP method for changing part of an existing resource, here some fields of one event.
- **Read-time policy:** rules applied when data is read, so changing a rule changes what is shown without rewriting stored data.
- **Commit:** in this app, sending one answer as final before the whole test is submitted.
- **Audit table:** an append-only record of changes, kept for people to read and for later decisions to consult.
- **Polling:** the client asking the server for fresh state on a timer, instead of the server pushing it.
- **Grace window:** the extra seconds after a deadline in which a submit still counts as on time (`SUBMIT_GRACE_SECONDS`, 60 by default).
