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

Think of a power strip with standard sockets. The strip does not care whether you plug in a lamp or a kettle, as long as every plug has the same shape. Adding an appliance means bringing a plug that fits, not rewiring the strip. CT Quest's question types now work like that on both sides of the app. The server and the student page each have a strip, and each question type brings one plug for each.

## What we did in this project

On the server, every question type is one module file in backend/src/scoring/types. The registry loads every file in that folder in name order when the app starts. Nobody has to add a line to a central list.

An active type file exports its name, a label, and a handful of pieces. The validate function checks a question of that type when content loads. The normalizeResponse function turns whatever the browser sent into a clean value, or nothing. The recordResponse function decides what is stored in the answers table, and it must describe what the student saw. Multiple choice stores the chosen index together with the option's text, so the record stays true even if the question is later corrected. The score function returns a status, points earned, maximum, whether it was correct, and optional structured detail, which lands in a detail column for things like AI feedback. Each type also exports a sample question and a list of public fields.

Reserved types are files too: multi-select, code trace, Parsons problems, short answer, and open response scored by AI. Each exports only its name, a label, a description and the status "reserved". The catalog lists them for the future teacher picker, and the content loader rejects any question that uses one. Implementing a type means filling in that one file.

What students see is built from an allowlist in two parts. A shared base list covers the fields every type shows, such as id, title, prompt, code and points. Each type adds its own public fields; multiple choice adds only its options. Anything else stays on the server: the answer key, ontology tags, outcomes, crosswalks, and the teacher-only details note, which often names the method. A test loops over every active type, takes its sample, stuffs in every secret field it can think of, and asserts the student copy drops them all and contains nothing outside the two lists. Another test checks the folder and the registry agree.

The student page has a matching registry. A small script, type-registry.js, asks the server's web-types endpoint which renderer files exist, loads each one, and exposes register and get. The server builds that list by reading web/types. Each renderer knows how to draw the answer area for its type, read the student's response back out of it, and describe a stored response in the results breakdown. The question screen and the results view dispatch through it. The list of files Express will serve is derived from the web folder the same way, so a new renderer is published without editing the allowlist, while package.json and build config stay private.

## Why this choice, and what the alternatives were

The first version had one central file that imported and registered each type, one hard-coded list of public files, and an index.html with a script tag per file. Each was a single shared line. Phase 2 will build several question types in parallel, on separate branches, often by separate Claude sessions. When every branch edits the same line, every merge conflicts, and a careless resolution can silently drop a type or, worse, an entry in a security allowlist. With "add a file, edit nothing shared", two branches that add Parsons problems and code tracing touch disjoint files and merge cleanly.

Loading from a folder has a cost. Behaviour depends on what files exist, which is less visible than a list. A stray file in the folder becomes a type, or a served script. The tests counter that: every file must be a valid registered type, every active type must pass the projection test, and the served list is checked to contain only html, css and js files and never build config.

An allowlist projection was kept over deleting known secret fields, because a denylist fails the day someone adds a field with a new name, such as a rubric. An allowlist fails by hiding a new public field, which is visible and harmless.

A switch statement on the type inside the submit route would work for two types. By five it spreads type knowledge through validation, projection and scoring. One table per type with typed columns would give the database more checking, but every new type would then need a migration.

## Glossary

Registry: a lookup table from a name to the implementation that handles it.
Strategy pattern: choosing between interchangeable implementations of one interface at run time.
Allowlist: a list of what is permitted; everything else is blocked.
Projection: a copy of a record that keeps only some of its fields.
Renderer: the browser-side code that draws one question type.
Parsons problem: a puzzle where students put shuffled lines of code into order.
