---
title: "Admin role: read-only oversight versus ownership"
date: 2026-09-27
project: ct-formative-assessment
tags:
  - authorization
  - role-based-access-control
  - api-design
  - security
status: unread
---

# Admin role: read-only oversight versus ownership

Think of a school's exam hall. Each teacher invigilates their own room: they hand out papers, collect them, and decide when the class can leave. The head of department walks the corridor and can look through any window, and can open any room's register afterwards. What the head does not do is walk in and collect a class's papers early. Looking and running are two different permissions, and the building works because they are kept apart.

CT Quest now has that corridor. Until today every account was a teacher, and a teacher could only ever see the events they created. Akmal decided that a head of department should see all of them. The design question was how far that power goes.

## What we did

The users table always had a role column, and it always said teacher. We added a second value, admin, and a database migration that normalises anything unexpected back to teacher and installs two triggers that refuse any other value. SQLite cannot bolt a check constraint onto an existing table without rebuilding it, so triggers are the usual way to get the same guarantee: every insert or update of a role passes through a small rule that aborts the write if the value is not teacher or admin.

The rule about who may do what lives in one small file, access dot js. It answers one question: given this account and this event, is the answer "manage", "read", or nothing? The owner gets manage. An admin looking at someone else's event gets read. Anyone else gets nothing. Every server route that takes an event id goes through a single helper that asks this question and turns the answer into an HTTP status. Nothing means 404, "event not found", the same reply a missing event gets. Read-only on a route that changes something means 403, "forbidden". Otherwise the route carries on.

The two codes are chosen on purpose. A teacher probing another teacher's event id gets the same reply as for an id that does not exist, so they cannot learn which ids are in use. An admin already knows the event exists, because it is in their list, so they get 403 with a sentence saying only the owner can change it.

On the page, each event now carries two flags from the server: whether you own it, and whether you may manage it. The page hides the Release, Edit settings and Reset buttons and the marking forms when you may not, and shows a one-line notice naming the owner. Admins also get a compact filter over the event list, "All teachers" or "Mine", plus a teacher picker.

The role is read from the database on every request, not from the sign-in token. Tokens last seven days, so a role baked into one would let a demoted admin keep their powers for a week. The lookup costs one primary-key read.

Accounts are managed from the command line with npm run set-role, and the very first account can be seeded as an admin with an environment variable.

## Why read-only, and what the alternative was

The alternative is full control: an admin can do anything the owner can, on any event. It has a real use. If a teacher is off sick, the head could release results, reset a student who got stuck, or mark the AI-scored answers waiting for review.

The cost is that two people can now change the same live event without seeing each other. The app records who changed a setting, but it does not record who pressed Release, and it keeps only an internal id for a reset or a mark. The owner's screen would even say "Marked by you" for a mark the head made. A teacher could find their class's results released in the middle of a lesson and not know why. Read-only avoids all of that: each event has exactly one person who can change it, and oversight never disturbs a lesson in progress.

We kept the flip cheap. The whole policy is one function in access dot js, and the page only ever reads the server's "may manage" flag, so switching to full control is a one-line change plus updating the tests that expect 403. The decision record, ADR 0004, lists what should be built before flipping: recording who released, reset or marked, and showing it.

Two other options were set aside. A separate admin area with its own pages keeps the code paths apart but doubles the interface to maintain. Fine-grained permissions, a list of abilities per account, are what large systems adopt when roles multiply; with two roles they add a permissions table and an editing screen for no gain.

## When you would reach for something else

If heads of department only needed numbers, an aggregated reporting view would expose less personal information. If departments had to be kept apart, the role would need a scope, such as "admin of the maths department", and access dot js would compare departments as well as owners. If admins regularly covered for teachers, full control with an audit trail becomes the better default.

## Glossary

Role-based access control (RBAC): deciding permissions by an account's role rather than listing each person's permissions one by one.

Authorization: deciding what a signed-in account may do. Authentication is proving who it is.

JSON Web Token (JWT): the signed sign-in token the browser sends with each request. Its contents cannot be changed without the server noticing, but they can go stale.

HTTP 403 Forbidden: the server knows what you asked for and refuses. HTTP 404 Not Found: the server says there is nothing there, which is also used to hide things you are not allowed to know about.

Trigger: a small rule stored in the database that runs before or after a write, here used to reject an invalid role.

Architecture decision record (ADR): a short document recording a design choice, the alternatives and the trade-offs.
