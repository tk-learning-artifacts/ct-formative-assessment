---
title: "Attempt tokens and auth hardening"
date: 2026-09-26
project: ct-formative-assessment
tags:
  - security
  - authentication
  - passwords
  - express
status: unread
---

# Attempt tokens and auth hardening

Think of a coat check. You hand over your coat and get a numbered ticket. If the tickets were numbered one, two, three and the attendant handed a coat to anyone who called out a number, you could collect your neighbour's coat by saying your own number plus one. A good coat check gives you a ticket with a random pattern that only the attendant can match. CT Quest had the first kind of coat check for student attempts. This change gives it the second kind, and tightens several other locks at the same time.

## What we did in this project

When a student starts a test, the server creates an attempt row and returns its id. Ids count up, one, two, three. Before this change, the submit endpoint needed only that id, so any student could submit answers for the attempt after theirs, overwriting a classmate's test.

Now, when an attempt starts, the server generates 32 random bytes and sends them to the browser, encoded as a URL-safe string. This is the attempt token. The database stores only a SHA-256 hash of it, so someone who reads a copy of the database still cannot submit on a student's behalf. The browser sends the token back in a request header called X-Attempt-Token when it submits. The server hashes what it receives and compares the two hashes with Node's timingSafeEqual function. A missing token gets a 401 status. A wrong token, including another attempt's valid token, gets a 403. Attempts started before the upgrade have no stored hash, so they are refused with a message asking the student to start again. The final update also only succeeds while the attempt is still marked started, so two simultaneous submits cannot both win.

Teacher routes are now scoped to the teacher who created the event. The events list filters by the creator, and the results route returns 404 for another teacher's event, exactly as if it did not exist. A 403 would confirm that an event with that id exists, which leaks a little information.

Passwords used scrypt, a deliberately slow hashing function. That part was good. But every user shared one fixed salt, and hashes were compared with a plain string equality. With a shared salt, two teachers with the same password have identical hashes, and one precomputed table attacks everyone at once. A plain string comparison can stop at the first differing character, which in principle leaks timing information. New hashes use 16 random bytes of salt per user, stored in a string that starts with "scrypt", then the salt, then the hash, separated by dollar signs. Comparisons use timingSafeEqual. A stored password cannot be rehashed without the password itself, so the verifier still accepts the old format. When a teacher logs in successfully with an old-format hash, the login route immediately rewrites it in the new format.

The server now refuses to start in production if the JWT_SECRET environment variable is missing. Previously it fell back to a development secret, and anyone reading the source could forge teacher tokens. Config is read in one module, and server.js exits with status 1 and a clear message.

The old static file serving published the whole web folder. That included questions.js with every answer, plus package.json and the Vite config. Now only five named files are served: the two pages, their two scripts and the stylesheet. Unknown routes under /api return a JSON 404 instead of the student page. Any path whose last segment contains a dot, including dotfiles like .env, gets a plain 404.

Timed attempts store a fixed deadline when they start. The server accepts a submission up to a grace window after it, 60 seconds by default and set with SUBMIT_GRACE_SECONDS, and marks it late. Previously, one second past the limit threw every answer away. The student page shows a countdown and auto-submits at zero, so an ordinary submission lands well inside the grace window.

## Why this choice, and what the alternatives were

A random token with a stored hash is the simplest thing that closes the hole, and each check is one database lookup. A signed JSON Web Token (JWT) per attempt would avoid storing anything. But revoking one would be harder, and a second signed-token scheme alongside the teacher tokens adds confusion. Server-side sessions with cookies would work too, but they bring cookie handling, cross-site request forgery (CSRF) protection and session storage for anonymous students who only need one submit. Switching attempt ids to random universally unique identifiers (UUIDs) would make guessing hard. But the id would then double as the secret, and ids get logged and shown in dashboards, which is exactly where secrets should not be.

For passwords, scrypt with per-user salts was kept because it was already in use and ships with Node. Argon2 is the current recommendation from the Open Worldwide Application Security Project (OWASP), and bcrypt is widely deployed, but both need native packages. The versioned hash format makes a later switch just another rehash-on-login.

The cost of the token is that a student who clears their browser storage mid-test cannot resume, since the page holds the token in memory only. Resuming would need a deliberate design, such as a teacher-issued resume code.

## Glossary

Bearer token: a secret whose possession alone grants access.
Hash: a one-way fingerprint of data; SHA-256 is a standard one.
Salt: random data mixed into a password before hashing so equal passwords hash differently.
scrypt: a password hashing function designed to be slow and memory-hungry.
Timing-safe comparison: an equality check that takes the same time however many characters match.
JWT (JSON Web Token): a signed token the server can verify without a database lookup.
Grace window: extra time after a deadline during which submissions are still accepted.
