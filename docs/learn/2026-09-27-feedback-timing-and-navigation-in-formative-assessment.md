---
title: "Feedback timing and navigation in formative assessment"
date: 2026-09-27
project: ct-formative-assessment
tags:
  - assessment-design
  - feedback
  - policy
  - api-design
status: unread
---

# Feedback timing and navigation in formative assessment

Think of a driving instructor. One kind sits beside you and says "too fast" the moment you take a corner badly. Another stays quiet for the whole drive and goes through everything at the end. A third hands you a written report next week, after every learner has driven the same route. All three are giving feedback. What differs is when, and what that timing does to the learner in the car and to the learners still waiting their turn. CT Quest now lets a teacher pick which instructor to be for each event, and separately whether students may go back over the route or must drive it once, forward.

## What we did in this project

Every event now carries two settings. Feedback timing is "after each question", "at the end of the assessment", or "when I release them", and the last is the default and the behaviour every existing event keeps. Navigation is "free", meaning back, next, skip and come back, or "in order", meaning forward only.

Both settings rest on one new server mechanism: committing a single answer. The student page sends one question's answer to a token-guarded endpoint, the server scores it and stores it with a committed timestamp, and from then on that answer is final. A second commit for the same question is refused, and when the student finally submits, the server keeps the committed rows and ignores anything the submit body says about those questions. So "locked" is a fact in the database, not just a greyed-out button.

Under "after each question", the commit response includes that question's result: right or wrong, the student's answer beside the correct one, and any feedback. Under "in order", every question is committed as the student leaves it, and the server accepts a commit only for the first question not yet committed. Asking to change an earlier question gets an "answer locked" refusal; jumping ahead gets an "out of order" refusal. The student may skip, which commits a blank answer worth zero, and a skipped question cannot be revisited. We chose an explicit skip over forcing an answer, because forcing an answer makes a student who does not know guess, and a lucky guess hides the very gap a formative check exists to find.

The decision about what a student may see stays in one file, the policy module. It already decided that the per-question breakdown waits for release. Now it also decides that the breakdown shows straight after submit under the two immediate modes, and that a committed answer carries its result only under "after each question". Every route that shows a student anything about correctness goes through it, and the tests check each mode for keys that arrive too early.

AI-scored written answers needed one more detail. When one is committed under "after each question", it is stored as pending, and the existing background job picks it up at once, because the answers table is already its queue. The student sees "being marked" until the score arrives, and the page quietly checks back every fifteen seconds.

## Why, and what the alternatives cost

Immediate feedback has the strongest short-term effect on learning when the task is practice. A student who learns within seconds that their loop runs one time too many can correct the mental model before it sets. The cost is the key. The moment one student sees the right answer, it can travel across the room to a student who has not reached that question yet. In a lesson where the goal is practice, that barely matters. In a check whose results a teacher will use to regroup the class, it quietly inflates the scores of the students who sit next to fast finishers. That is why the default stays "when I release them", and why the teacher's form shows a warning under the two immediate modes.

Feedback at the end sits between the two. The student gets their breakdown while the test is still fresh in their mind, which is when feedback is most likely to be read at all, and nobody can change an answer after seeing it because the attempt is already submitted. The leak risk is the same, just later.

Delayed feedback, the release model, protects the key best and suits checks run across several classes over a week. Its cost is that feedback arriving days later is often never opened.

For navigation, free movement matches how people actually take tests: skim, do the easy ones, return to the hard ones. Linear, forward-only navigation measures something narrower, first-pass reasoning, and it prevents a later question from giving away an earlier one, which matters when questions in a set build on each other. Its costs are anxiety for some students and a lost chance to catch their own mistakes. The combination of linear navigation with immediate feedback is the classic tutoring loop: try, see, move on, and never rewrite history once you have seen the answer.

One alternative we rejected was enforcing all of this only in the browser. It would have been less code, but a student using the browser's developer tools could send answers for questions they had not reached, or change an answer after seeing its key. The server-side commit costs one endpoint and one column, and it makes the rules hold whatever the page does.

## Glossary

- **Formative assessment:** a check whose purpose is to guide the next bit of teaching, not to grade.
- **Commit:** sending one answer to the server as final, before the whole test is submitted.
- **Linear navigation:** forward-only movement through the questions, with no going back.
- **Answer key leak:** a correct answer reaching a student who has not yet answered that question.
- **Policy module:** the single backend file that decides what a student may see about their own results.
- **API (Application Programming Interface):** the set of web addresses the page calls to talk to the server.
