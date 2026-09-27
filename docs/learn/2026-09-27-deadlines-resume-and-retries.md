---
title: "Deadlines, resuming after a refresh, and retrying submissions"
date: 2026-09-27
project: ct-formative-assessment
tags:
  - time-zones
  - frontend
  - resilience
  - web-storage
status: unread
---

# Deadlines, resuming after a refresh, and retrying submissions

Think of an exam hall with a clock on the wall. The invigilator says "pens down at ten", meaning ten by that clock, not by whatever a student's watch says. A student who knocks their papers off the desk can pick them up and carry on. And if the runner collecting scripts trips on the stairs, they get up and try again rather than throwing the scripts away. This round made CT Quest's timing and submission behave like that hall.

## What we did in this project

The first fix was about time zones. The teacher page used the browser's datetime-local input, which produces a time with no zone, such as "2026-10-01T09:00". The server parsed that string in its own zone. In Docker the server runs in Coordinated Universal Time (UTC), so a Singapore teacher's 09:00 opening became 09:00 UTC, which is 17:00 in Singapore, eight hours late. Now the browser converts the input with the teacher's own zone and sends an absolute time ending in Z. The server rejects any date without a Z or an explicit offset, so the mistake cannot quietly come back from another client. Times are stored in UTC, and the TZ setting in Docker only affects log timestamps.

The second fix was the deadline. An attempt's deadline is fixed when it starts, as the earlier of start plus duration and the event's end time. It is set whenever either exists, so an event with only an end time still has a deadline. Previously the event's end time stopped new starts but was never checked at submit.

A small grace window, sixty seconds by default, still counts as on time. It absorbs the auto-submit's own network trip and a slow phone. After that, the answers are no longer thrown away with an error. They are stored, and the attempt gets a persisted late flag, which teachers see as "late" beside the student's name. Losing a whole test to a flaky network was worse for everyone than a flagged, slightly late script.

The third fix was resuming. The page keeps the attempt id, its secret token, the answers so far and the current question in the tab's session storage, saving on every change. After a refresh, it calls a token-guarded GET for the attempt. The server returns the questions, the deadline and the current server time, so the countdown is corrected for a wrong device clock. If the attempt was already submitted, it returns the result instead, and if a teacher reset it, the page says so. Every storage access is wrapped in try and catch. Private browsing modes and locked-down school devices can refuse storage or throw when it is touched, and the test must still run, just without resume.

The fourth fix was submission itself. Students can submit from any question, with a confirmation naming how many are unanswered. If the network fails or the server answers with a 500-range error, the page retries with growing waits: one, two, four, eight, fifteen, then thirty and sixty seconds. It tells the student their answers are saved and when it will try again. A conflict, meaning already submitted, perhaps by another tab, simply shows the result.

## Why this choice, and what the alternatives were

Sending absolute times is the standard fix. The alternative, sending the teacher's zone name alongside a local time, pushes zone arithmetic onto the server and still breaks when a client forgets the zone. Rejecting zone-less input is stricter than guessing, which is the point.

The late flag replaces a hard refusal. A stricter exam might want the refusal, and the flag makes that easy to add later as a policy: the data is kept and the decision is visible.

Server-side autosave, sending each answer as the student picks it, would survive a lost device, not just a refresh. It costs a request per click, a new table or column of draft answers, and more care with the one-attempt rule. For a classroom quiz on a single device, session storage covers the common case of an accidental refresh. WebSockets would allow live progress for teachers and instant autosave, but they bring connection handling and scaling work that a single SQLite server does not need yet.

Session storage was chosen over local storage on purpose. Local storage survives closing the browser, which on a shared school computer means the next student could open the page and land inside the previous student's attempt, token included. Session storage ends with the tab.

Retrying with growing waits avoids hammering a struggling server, and a cap on the number of tries means the student eventually gets a clear error rather than an endless spinner.

## Glossary

UTC (Coordinated Universal Time): the time standard with no zone offset; Singapore is UTC plus eight hours.
ISO 8601: the standard date-time text format, ending in Z for UTC or an offset such as +08:00.
datetime-local: a browser input that yields a date and time with no time zone.
Grace window: extra time after a deadline that still counts as on time.
Session storage: browser storage that lasts only as long as the tab.
Exponential backoff: retrying with waits that grow each time.
