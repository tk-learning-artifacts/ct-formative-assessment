---
title: "One attempt per student, and releasing results later"
date: 2026-09-27
project: ct-formative-assessment
tags:
  - assessment-design
  - security
  - policy
  - unicode
status: unread
---

# One attempt per student, and releasing results later

Imagine a combination lock that beeps once for every correct digit whenever you try a code. Nobody needs the combination: try all tens, count the beeps, then all twenties, and you have it in a few dozen tries. A quiz that tells you which questions you got right, and lets you try again, is that lock. The fix is to give each person one try, and to keep the beeps quiet until the lock no longer matters.

## What we did in this project

The review found an answer-key oracle. A student could start an attempt, answer option A to every question, and read the per-question breakdown. Then they could start again with all option B, then C, then D. Four submissions under any name revealed the whole key, which could be shared with the class. Akmal decided the policy, and it lives in one small file, backend/src/policy.js, so the rule has a single home.

First, one attempt per student per event. A student has no account, so they are identified by the name and class group they type, turned into a student key. The key is built in four steps, each for a reason. Unicode NFKC (Normalization Form Compatibility Composition) folds look-alike forms together, so a name typed in full-width letters on a phone keyboard matches the plain version, and accented letters typed as one character or two match. Leading and trailing spaces are trimmed and runs of whitespace collapsed to one, so "Ada  Tan" with an accidental double space is still Ada Tan. Letters are lower-cased, so "ADA TAN" and "ada tan" match. The name and group are joined with an invisible separator character that no keyboard produces. The check for an existing attempt and the insert of a new one happen in the same database transaction. The database driver is synchronous, so two simultaneous starts cannot both slip through.

A second start returns a conflict with a code. "Already submitted" tells the student to ask the teacher. "In progress" includes the attempt's id, so if this browser tab still holds that attempt's token, the page quietly resumes it. Without the token, the student has to ask the teacher, because the id alone proves nothing. An attempt from before the upgrade, which has no token and can never be finished, does not count against the student.

Second, teacher reset. The teacher's results view has a Reset button per attempt. Resetting marks the attempt with a time and the teacher's id rather than deleting it, so the record of what happened survives, and the student may start again. A reset attempt can no longer be submitted. Only the teacher who owns the event can reset, and anyone else gets the same 404 as for a missing event.

Third, results release. On submit, a student sees only their total. The per-question breakdown, meaning which questions were right, the chosen and correct options, and any AI feedback, is held back. It appears once the event's deadline has passed, or once the teacher presses "Release results", which stamps a release time on the event. Every route that shows a student their result passes through one function in policy.js, which strips the breakdown when it is not yet released. A test checks the submit response and the resume response, including a simulated AI feedback note, and finds no per-question correctness before release. Another replays the oracle: four starts under one name get one total and three refusals.

Events created before the upgrade were marked released during the migration, so classes already using them see no change.

## Why this choice, and what the alternatives were

Rate limits, such as one attempt per minute, only slow the oracle down, and a class has plenty of time. Shuffling question order per attempt does not help, because questions carry visible ids and titles. Shuffling option order per attempt defeats "all A" guessing, but a student can still read which option text was right from the breakdown. It would also complicate the stored records and the answer-key tests.

Per-student randomised variants, such as different numbers in each grid, are the strongest defence. Each student's key is different, so sharing it is useless. But every question would need a generator and a solver, which is a large content effort, and it makes comparing results across a class harder. It remains a good Phase 2 idea for high-stakes use.

Accounts or single sign-on (SSO) through the school would identify students properly, so name tricks like "Ada Tan 2" would stop working. The cost is onboarding every student, managing passwords or an identity provider, and handling more personal data for minors. For formative quizzes run by a teacher in the room, name plus group, with a teacher who can see and reset attempts, is the lighter trade. A determined student can still invent a new name; the teacher sees it in the results list.

Holding back the breakdown costs something in learning value, because feedback is most useful soon after the attempt. Tying it to the deadline, with a release button for teachers who want it sooner, keeps most of that value.

## Glossary

Answer-key oracle: any feature that lets repeated tries reveal the correct answers.
Student key: the normalised name and group that identifies a student within an event.
NFKC: a Unicode normalization that folds look-alike character forms into one standard form.
Reset: a teacher action that retires an attempt, keeping its record, so the student can start again.
Release: the moment the per-question breakdown becomes visible to students.
SSO (single sign-on): logging in with an existing account, such as a school one, instead of a new password.
