---
title: "Parsons problems, and how the shuffled lines avoid giving away the answer"
date: 2026-09-27
project: ct-formative-assessment
tags:
  - assessment-design
  - parsons-problems
  - question-types
  - seeded-randomness
  - answer-key-protection
status: unread
---

# Parsons problems, and how the shuffled lines avoid giving away the answer

Picture a recipe card cut into strips, one step per strip, dropped on the table in a heap. You don't have to invent the recipe. You have to know it well enough to put the strips back in order, and to spot the strip from a different recipe. That is a Parsons problem, described by Dale Parsons and Patricia Haden in 2006: the student gets every line of a working program, scrambled, and rebuilds it.

## What we did in this project

The "parsons" question type had been reserved since Phase 1, meaning it had a name but no scorer. It is now active, alongside "code-trace", where the student reads a program and types what it prints.

A Parsons question lists its lines, each with a short id and its text. The answer key is the correct order of ids, plus optional alternative orders. In "add up the even numbers", for example, the lines that create the list and set the total to zero can go either way round. Lines in no order are distractors, and the student must leave them out. The Swift question offers "let" where "var" is needed, and a loop that stops one short.

Indentation is part of each line's text. Letting students set indentation themselves is a harder variant. We left it out for Phase 2 so the question stays about order and choice, and it can be added later inside this one type.

Marking is all or nothing unless a question opts into partial credit from the longest correct run. That is the longest stretch of the student's program that matches a stretch of some correct order, line for line. The score is that length out of the longer of the student's program and the solution, so extra lines cost marks. Lines are compared by text, so two identical closing braces can swap freely.

On the page, every line starts in a pool. The student builds their program from it with buttons to add a line, move it up or down, or remove it, so the task works from the keyboard alone. Focus follows the moved line, and a message for screen readers announces its position. Dragging by a handle is an extra. It uses pointer events, which handle mouse, finger and pen alike, and only the handle blocks touch scrolling.

## The leak, and how the shuffle stops it

The browser has to receive the lines, and copying them straight from content leaks the answer three ways. Authors naturally write lines in the correct order. Ids like a, b, c in solution order give the answer away when sorted. And a random shuffle can land on a correct order by chance: with four lines and two accepted orders that is one in twelve, so across a dozen questions one would probably ship already solved.

The registry gained an optional hook that lets a type rewrite its public fields before the allowlist copies them. Parsons uses it in two steps. First it replaces every line id with an opaque one, ten hex characters derived from the question id and line id. The server maps these back on submit and rejects real content ids, which a student could only know from a leak. Then it orders the lines with a Fisher–Yates shuffle driven by a small seeded generator (mulberry32). Every student and every refresh sees the same order, and nothing is stored. After shuffling, the server reads the solution lines top to bottom, skipping distractors, and compares them by text with every accepted order. It also compares the full list with the content order. On any match it draws the next shuffle, up to two hundred times, and for short questions then tries every order in turn.

The first version derived both the ids and the shuffle's seed from things a student can see: a plain SHA-256 hash of the question id and line id, and a seed made from the question id alone. The review showed what that means for a student who has read this repository, or asked an AI assistant to. Hashing every word in a dictionary recovered every line id in two of the three sample questions, and most of the third. The ids were words like "odd", "count" and "let", so they labelled the distractors. Worse, the seeded shuffle could simply be replayed. The permutation depends only on the seed and the number of lines, so running it and inverting it turned the shown order back into the order the author typed. Authors type the solution first and the distractors after it, so that inverted order was the whole answer, for all three questions. Rejecting a shuffle that shows a correct order did not help, because the attack never looks at the shown order's meaning, only at how it was produced.

The fix keys both with a server secret. The server derives a separate key from JWT_SECRET, the secret it already requires in production, and uses HMAC, a keyed hash, for the ids and for the shuffle's seed. Without the key, neither the dictionary attack nor the replay gets anywhere, and tests keep both attacks in the suite. Deriving a sub-key rather than reusing the secret directly keeps the two uses from sharing a key. The cost is that rotating JWT_SECRET changes every public line id, so a Parsons answer that is in progress at that moment no longer maps back and scores zero. That is also true of teacher logins, which rotation already signs out.

Some questions can't be hidden at all, such as three lines where every order is correct. Validation checks at boot that some safe order exists, so such a question stops the server with a message asking for another line or a distractor. Tests run every shipped question and three hundred generated ones through these checks.

## Why this choice, and what the alternatives were

A fresh shuffle per student would make copying from a neighbour's screen slightly harder. But the order would then need storing per attempt, or it would change on refresh, and a student reconnecting shouldn't find their pool rearranged. With one attempt per student and a teacher-controlled release, a fixed order per question is enough.

Hand-writing a shuffled order into content is simple, but it goes stale when a line is edited and still needs a test to catch a correct order. Once that test exists, the machine may as well shuffle.

For partial credit, the longest common subsequence rewards lines in the right relative order even with gaps, and edit distance counts the moves needed to fix the program. Both are more generous. We chose the contiguous run because code works in unbroken stretches: two right lines around a wrong one still fail.

Parsons problems test less than writing from scratch, since a student can sometimes eliminate options, for example by noticing that only one line ends with a colon. Still, Denny, Luxton-Reilly and Simon (2008) found Parsons scores correlate well with code-writing scores, and they are far easier to mark consistently. That suits a formative quiz, and wrong orders show misconceptions such as a print statement on the wrong side of an increment.

## Glossary

- **Parsons problem:** reorder given lines of code, leaving out distractors, into a working program.
- **Distractor:** a plausible line that belongs in no correct answer.
- **Fisher–Yates shuffle:** the standard shuffle in which every order is equally likely.
- **Seeded generator:** produces the same "random" sequence from the same starting value.
- **SHA-256 (Secure Hash Algorithm, 256-bit):** a hash function. On its own it hides nothing that can be guessed, because anyone can hash their guesses.
- **HMAC (Hash-based Message Authentication Code):** a hash keyed with a secret, so only the holder of the key can compute or check it.
- **Public projection:** the student-safe copy of a question, built from an allowlist (see the scorer registry explainer).
- **Longest correct run:** the longest unbroken stretch of the student's program that matches some correct order.
