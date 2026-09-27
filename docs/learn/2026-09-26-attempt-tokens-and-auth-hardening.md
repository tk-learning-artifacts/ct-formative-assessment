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

Think of a coat check. You hand over your coat and get a numbered ticket. If the tickets were numbered one, two, three and the attendant handed a coat to anyone who called out a number, you could collect your neighbour's coat by saying your own number plus one. A good coat check gives you a ticket with a random pattern that only the attendant can match. And when you show a wrong ticket, a good attendant says "no coat for that ticket" whether or not the number exists. CT Quest had the first kind of coat check for student attempts. This change gives it the second kind, and tightens several other locks at the same time.

## What we did in this project

Attempt ids count up, one, two, three. Before this change, submitting needed only the id, so any student could overwrite the attempt after theirs. Now, when an attempt starts, the server generates 32 random bytes and sends them to the browser as the attempt token. The database stores only a SHA-256 hash of it, so a copy of the database cannot be used to submit on a student's behalf. The browser sends the token in a header called X-Attempt-Token, both to submit and to resume after a refresh. The server hashes what it receives and compares with Node's timingSafeEqual.

A missing token gets a 401. A wrong token and an attempt id that does not exist get the same 404 with the same message. If they differed, a student could walk the ids with a junk token and learn which attempts exist and how many classmates have started. One check deliberately runs before the token check: an attempt from before the upgrade has no stored hash at all, so it gets a 403 telling the student to start again. Earlier, that check sat behind the token check and its message could never be reached. The final update also only succeeds while the attempt is still marked started, so two simultaneous submits cannot both win.

Teacher routes are scoped to the teacher who created the event. Another teacher's event, results, release or reset returns 404, the same as a missing one, because a 403 would confirm the event exists.

Passwords use scrypt, a deliberately slow hash, now with 16 random bytes of salt per user and a timing-safe comparison. Old hashes, made with one shared salt, still verify and are rewritten in the new format on the next successful login.

The first teacher account now comes from two environment variables, SEED_TEACHER_EMAIL and SEED_TEACHER_PASSWORD, and is only created in an empty database. In production the server refuses to start in any of these cases: JWT_SECRET is missing; the seed password is missing or is the demo password "changeme123"; or any stored account still accepts the demo password. The last check verifies every stored hash against the demo password at boot, so it also catches the account the original code seeded into a volume that has been running for months. The error names the accounts and points to the fix.

That fix is npm run set-password, followed by an email. It sets the password, or creates the account. It reads the password from the NEW_PASSWORD variable or from standard input, with a hidden prompt when typed at a terminal, and it rejects anything passed as an extra command-line argument. Arguments end up in shell history and in process listings any other user on the machine can read, so a password there has already leaked.

Static serving only publishes the site's own pages, scripts and styles. Unknown API routes get a JSON 404, and paths that look like files, including dotfiles such as .env, get a plain 404.

## Why this choice, and what the alternatives were

A random token with a stored hash is the simplest thing that closes the hole, with one lookup per check. A signed JSON Web Token (JWT) per attempt would avoid storage, but revoking one is harder, and a second signed-token scheme next to the teacher tokens adds confusion. Server-side sessions with cookies bring cross-site request forgery (CSRF) protection and session storage for anonymous students who only need one submit. Random universally unique identifiers (UUIDs) as ids would make guessing hard, but the id would double as the secret, and ids get logged and shown on dashboards.

Refusing to boot is stricter than warning in the logs, and it can surprise an operator the first time. But a warning in a container log is rarely read, and a live demo password on a school system is the kind of mistake that stays live for a year. The seed password stays required in production even after the account exists, which is slightly clunky but keeps the rule simple to state and check.

For passwords, scrypt ships with Node. Argon2, recommended by the Open Worldwide Application Security Project (OWASP), and bcrypt both need native packages. The versioned hash format makes a later switch just another rehash-on-login.

## Glossary

Bearer token: a secret whose possession alone grants access.
Hash: a one-way fingerprint of data; SHA-256 is a standard one.
Salt: random data mixed into a password before hashing so equal passwords hash differently.
Timing-safe comparison: an equality check that takes the same time however many characters match.
Enumeration: learning which ids exist by probing and comparing responses.
Seed account: the first user created automatically in an empty database.
JWT (JSON Web Token): a signed token the server can verify without a database lookup.
