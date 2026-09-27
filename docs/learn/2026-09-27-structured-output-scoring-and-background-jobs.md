---
title: "Marking written answers with a model: structured output through OpenRouter, and a job that runs after submit"
date: 2026-09-27
project: ct-formative-assessment
tags:
  - ai
  - openrouter
  - structured-output
  - background-jobs
  - queues
  - minors-data
status: unread
---

Picture a school that sends its essay marking to an outside examiner. The office does not post the essays the moment a student hands one in; it drops them in an out-tray and tells the student "your mark will follow." A clerk empties the tray a few at a time, blacks out every name before an envelope leaves, and sends each one with a mark sheet that has boxes to tick and no room for anything else. When a sheet comes back with scribbles outside the boxes, the clerk does not guess what the examiner meant; it goes on the teacher's desk instead. If the office closes overnight, the tray is still there in the morning.

That is how CT Quest now marks free-text answers. The earlier [AI guardrails explainer](2026-09-26-ai-guardrails-typed-payload-and-structured-output.md) covers the blacking-out and the mark sheet: the typed payload, the redaction, and the validator. This one covers the new parts: talking to the model through OpenRouter with structured output, and the out-tray, a background job.

## What we did in this project

There is a new question type, open response scored by AI. A student reads a prompt such as "explain why this loop never ends" and types a few sentences. Each question carries a server-only rubric: criteria with an id, a description and a point value.

When the student submits, the server does not call any model. It stores the answer with the status "pending" and zero points, and replies with the total straight away. A job in the same Node process then looks for pending answers, oldest first, and scores at most two at a time by default. For each one it builds the redacted payload, sends one request to OpenRouter, validates the reply, and writes either "scored" or "needs review." In the same transaction it recomputes the attempt's total, so the student's score rises when marking finishes; their results page says "being marked" and checks back every fifteen seconds.

OpenRouter is a single application programming interface (API) in front of many model providers. We send it a chat request with two messages, the fixed system instructions and the payload in JavaScript Object Notation (JSON), plus a response format of type "json schema" with strict mode on. The schema allows exactly a criterion id from this question's rubric, an integer score, a feedback code from a fixed list, and an optional sentence of feedback. Strict mode asks the provider to constrain generation to that shape. We still validate every reply ourselves, because OpenRouter's own documentation says enforcement varies by provider.

Three routing options go with every request. "Require parameters" tells OpenRouter to route only to endpoints that support everything we sent, so the schema is never silently dropped. "Data collection: deny" rules out endpoints that may store or train on prompts. "Zero data retention" rules out endpoints that keep the request at all. The default model, Claude Sonnet 5, was chosen from OpenRouter's model list because it supports structured output and has zero-retention endpoints that do too.

The first live test failed usefully. We had also sent a temperature of zero. None of Sonnet 5's endpoints list temperature as supported, so "require parameters" filtered out every endpoint and OpenRouter answered "no endpoints found." Without it, the second call came back valid. Under strict routing every extra parameter narrows the pool, so we only send what the model's endpoints advertise.

## Why this choice, and what the alternatives were

The first decision was to score after submit instead of during it. Scoring inside the submit request would be simpler, but a model call takes one to ten seconds, longer under rate limiting, and a timed quiz auto-submits a whole class at the deadline: forty students times three answers is a hundred and twenty calls in one minute. Holding every submit open for that would make submissions time out, and the page's retries would pile on more. Decoupling means submit is always fast, and the concurrency cap spreads the model calls out.

The second decision was where the queue lives. A dedicated queue, such as Redis with a job library or a cloud queue service, gives retries, visibility and many workers, but adds a service to run, and this app deliberately runs as one container with SQLite. Instead, the answers table is the queue: "pending" rows are the work list, found through a small index. Nothing lives only in memory, so after a restart the job finds rows still pending, including ones mid-flight when the process died, and scores them. The cost is that a row interrupted mid-flight is sent twice, which for a formative score costs a fraction of a cent.

Two details make this safe. The job only writes if the row is still pending, so a teacher's mark made while the model was thinking wins. And a failing request does not stay pending forever: after two retries with backoff it becomes "needs review," because an endless retry loop against a paid API during an outage is worse than a teacher marking a few answers.

The third decision was the fallback. When a reply is malformed, breaks the schema, or never arrives, we could retry with a sterner prompt or repair the JSON. Both risk storing something the model did not cleanly say about a child's work. Here, anything that fails validation becomes zero points and "needs review," with none of the model's text kept. With AI switched off, every open answer takes that path, and creating an event with such questions returns a warning.

## Glossary

Structured output: a model feature that constrains the reply to a JSON schema you supply, instead of free text.

Endpoint: one provider's hosting of one model; the same model can have several with different features and data policies.

Zero data retention (ZDR): an endpoint that does not store requests or replies.

Conditional write: an update that only applies if the row is still in the state you expect, so running it late, or after someone else's change, does no harm.

Backoff: waiting longer between each retry, and honouring a server's "retry after" hint.
