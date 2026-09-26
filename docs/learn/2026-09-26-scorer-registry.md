---
title: "The scorer registry: one plug-in per question type"
date: 2026-09-26
project: ct-formative-assessment
tags:
  - architecture
  - plugin-pattern
  - strategy-pattern
  - scoring
status: unread
---

# The scorer registry: one plug-in per question type

Think of a power strip with standard sockets. The strip does not care whether you plug in a lamp or a kettle. It only needs every plug to have the same shape. Adding a new appliance means building a plug that fits, not rewiring the strip. The scorer registry is that power strip for question types. The submit route, the student page and the content loader all talk to "a question type" through the same small set of functions, and each type, starting with multiple choice, provides its own implementation.

## What we did in this project

The registry lives in backend/src/scoring. Each question type registers one object with a type name, a label and five functions. The validate function checks a question of that type when content loads, and returns a list of errors. For multiple choice, that means at least two distinct non-empty options and an answer index that points at one of them. The toPublic function returns the version of the question a student may see. The normalizeResponse function turns whatever the browser sent into a clean stored response, or nothing if it is unusable. For multiple choice, it accepts a whole number, or a string of digits, within the option range, and anything else counts as no answer. The score function takes the question and the cleaned response and returns a status, points earned, maximum points and whether it was correct. The optional legacyColumns function fills the old chosen-index and correct-index columns, so the teacher's existing results view keeps working.

Multiple choice is the only active type. Five more are registered as reserved: multi-select, code trace, Parsons problems (dragging code lines into order), short answer, and open response scored by AI. They appear in the catalog endpoint, so the future teacher picker can show them, but the content loader rejects any question of a reserved type. A test proves the plug-in path works. It registers a throwaway short-answer implementation that accepts a list of answers, then scores " 16 " as correct against "sixteen" or "16".

The submit route never asks what kind of question it is looking at. For each question in the event, it calls the registry's scoreResponse with the raw answer. It stores the normalized response as JSON in a response column, alongside the question type, the points and a score status, all in one transaction.

The score status allows for types that cannot be marked instantly. Multiple choice returns "scored". An AI-scored type will return "pending" at submit time, so the student is never kept waiting on a model. A background job then settles it as "scored", or as "needs-review" when AI is switched off or the model's output fails validation. The answers table already has the score status column, added in migration 2, so that later work does not need another schema change.

Answer keys are kept away from students by an allowlist. The multiple choice implementation lists the fields a student may see: id, type, audience, level, title, prompt, art, code, options, points, topic, the display label, and details. toPublic copies only those fields. Everything else stays on the server: the answer, the ontology tags, the learning outcomes, the crosswalk, and any future rubric or solution field. The submit response also stopped returning the correct index for each question. The student page never displayed it, but any student could read it from the network response and share it.

## Why this choice, and what the alternatives were

The original code removed one named field, answerIndex, and sent everything else. That is a denylist, and it fails the moment someone adds a new secret field under a different name, such as a rubric for AI marking or a worked solution for code tracing. An allowlist fails the other way. A new public field stays hidden until someone adds it to the list, which is a visible, harmless bug. The no-answer-leak test backs this up. It walks every key in the join, start, submit and preview responses and fails on any key named answer, correct index, accepted, rubric or solution.

A registry of strategy objects was chosen over a switch statement on the type inside the submit route. A switch works fine for two types. By five it spreads type knowledge across validation, the public view and scoring, in several files. With the registry, adding a type is one file that registers itself, and the rest of the app needs no change.

A heavier alternative would be one table per question type with typed columns. That gives the database more checking, but every new type then needs a migration and new queries. Storing each question as validated JSON, with a few indexed columns for filtering, keeps new types cheap. The cost is that the type's own validate function, not the database, guarantees the question's shape.

Scoring stays synchronous for everything except AI-scored types, because a teacher expects to see a multiple choice score the instant a student submits.

## Glossary

Registry: a lookup table from a name to the implementation that handles it.
Strategy pattern: choosing between interchangeable implementations of one interface at run time.
Allowlist: a list of what is permitted, where everything else is blocked. A denylist is the reverse.
Projection: a copy of a record that keeps only some of its fields.
Parsons problem: a puzzle where students put shuffled lines of code into the correct order.
Normalization: turning varied input into one clean, predictable form.
