---
title: "Debounced live previews and tree rollups in the event picker"
date: 2026-09-27
project: ct-formative-assessment
tags:
  - frontend
  - debouncing
  - aggregation
  - reporting
status: unread
---

# Debounced live previews and tree rollups in the event picker

Picture a search box on a shopping site. If it fired a request to the server on every single keystroke, typing "sneakers" would send eight separate queries, most of them for half-typed words nobody cares about, arriving back out of order and flickering the results. What every such box actually does is wait for a short pause in typing, then send one request for whatever was typed during that pause. That waiting trick is called debouncing, and it is the mechanism behind the teacher's live question-count preview in the new event picker, alongside a second, unrelated idea used in the same feature: rolling values up a tree, used both to size the CT ontology checkboxes and to summarise results by learning outcome.

## What we did in this project

The teacher portal's "Advanced: choose what to test" panel lets a teacher tick an audience, some levels, learning outcomes, CT ontology nodes, question types and a difficulty band. Every one of those choices changes which questions would end up in the event, and the panel shows that answer live: a running count of questions, total points, and a breakdown by level and type, by calling `POST /api/question-bank/preview` with the filter built from the current selections.

Calling that endpoint on every checkbox click would work, but it would also mean that ticking five outcomes in a row fires five network round trips, and because they are not guaranteed to come back in the order they were sent, a slow early response could overwrite a faster later one and show stale numbers. The fix in `web/admin.js` is a small debounce: every change to the picker schedules a preview call 300 milliseconds in the future, and if another change arrives before that timer fires, the old timer is cancelled and a new one takes its place. Only once the teacher pauses for 300 milliseconds does a request actually go out. A second safeguard rides alongside the debounce: each preview request carries an increasing request number, and when a response comes back the code checks whether a newer request has since been sent. If so, the response is simply dropped. That combination — wait for a pause, then ignore anything but the latest answer — is what keeps the panel showing the truth even when a teacher is quickly clicking through several ontology nodes.

The second idea, tree rollup, shows up twice in this workstream, for two different purposes. In the picker itself, the CT ontology is a tree: three root categories (concepts, practices, perspectives) with narrower nodes underneath, down to specifics such as "searching and sorting" or "reviewing AI-generated code". Each node in the tree carries a count of questions tagged directly to it, but a teacher ticking the "concepts" checkbox is choosing every question tagged anywhere beneath concepts too, because that is how the selection filter already behaves on the server. Showing "0 questions" next to "concepts" — its direct-tag count — would be actively misleading, so the picker walks the tree once, bottom-up, adding each node's own count to the sum of its children's counts, and displays that rolled-up total instead.

The other use of the same shape lives on the server, in the new per-outcome results summary (`backend/src/outcomes-summary.js`). For a report like "how did students do on the loops concept", a question tagged only with the specific node "concept.loops" still needs to count towards the broader "concept" heading, exactly the way the picker's node selection works. The summary endpoint expands each reported node to the set of its own id and every descendant, checks which of the event's questions carry any tag in that set, and only then computes the mean score and the count of students below 50% across that group. Two different rollups, same underlying idea: a tree's parent inherits everything its children have.

## Why this choice, and what the alternatives were

The alternative to debouncing is throttling, which fires at most once every fixed interval regardless of pauses — useful for something like a scroll handler that must never go silent for too long, but wrong here, because a teacher mid-click doesn't want to see intermediate previews for selections they are about to change again. A React-style app might reach for a library hook (`useDebouncedValue` or similar), but this project's frontend is deliberately dependency-free plain JavaScript, so the debounce is a dozen lines with `setTimeout` and `clearTimeout` rather than a package. The request-ordering guard is the part that is easy to skip and later regret: without it, a debounce alone still leaves a narrow window where a slow response to an old request beats a fast response to a new one.

For the rollup, the alternative was to have the server pre-compute and ship a rolled-up count for every node inside `/api/ontology`, so the client would not need to do the walk itself. That was rejected for being the wrong layer: the server's `questionCount` is a direct, unambiguous fact about a node, and folding in an assumption about how the picker intends to use it (as an inclusive selection) would make that one field mean two different things depending on the caller. Computing the rollup where it is used — once in the browser for display, once on the server for the results aggregation — keeps each side's data true to what it actually means, and the computation stays trivial either way, since the ontology tree involved is only a few dozen nodes.

## Glossary

Debounce: delay an action until a burst of triggering events has paused, then run it once for the latest state.
Throttle: run an action at most once per fixed time interval, regardless of how many triggers arrive.
Race condition: a bug caused by two operations finishing in an order the code did not expect.
Rollup: combining a node's own value with the values of everything beneath it in a tree.
Tag: a label attached to a question (an ontology node id, in this case) used to group or filter it.
