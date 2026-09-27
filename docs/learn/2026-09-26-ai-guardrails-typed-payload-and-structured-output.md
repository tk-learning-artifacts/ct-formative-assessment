---
title: "AI guardrails: typed payloads in, structured output out"
date: 2026-09-26
project: ct-formative-assessment
tags:
  - ai
  - privacy
  - structured-output
  - security
  - minors-data
status: unread
---

# AI guardrails: typed payloads in, structured output out

Picture a hospital lab that sends blood samples to an outside company. The lab's own clerk fills in the form from the sample's barcode, and the form has boxes only for the tests requested, so there is nowhere to write a name. Doctors cannot hand the courier their own form or a covering letter. When results come back, a technician checks each value is in range before it goes near a patient, and anything odd is flagged for a human. CT Quest's AI extension point is built the same way, and the review round closed the gaps where a caller could still slip a note into the envelope.

## What we did in this project

No AI provider is called yet. OpenRouter is the decided Phase 2 provider, and the app works fully without a key. Everything lives in backend/src/ai and is off unless AI_PROVIDER is set.

A provider adapter registers under a name and has one method that sends a request. Nothing outside the module ever touches it. Creating a provider returns a frozen wrapper whose only method is score, which takes exactly one argument, a payload. The wrapper checks the payload came from the builder (the builder records each one in a WeakSet and deep-freezes it, so a copy or an edited payload is refused). It then builds the whole request itself: a fixed system prompt constant, a JSON Schema derived from the payload's own rubric, the payload and a token limit. A caller has no way to pass its own system prompt, schema or extra key. Review found that an earlier version let a student's name ride along in the system prompt or an extra request field, and tests with a spy adapter now try each of those and assert the adapter was never called.

The builder no longer accepts question content. It takes the store, an optional event id, a question id, the response text, and the student's name and class group. It looks up the question in the event's frozen snapshot, or in the bank if there is no event, and the learning-outcome statements in the validated content. Earlier, a caller could pass a question whose prompt contained a name, or an outcome statement with one, and it went straight out. Passing a question or outcome object now throws, naming the rejected argument.

The name and group are required, used only to scrub the response, and never sent. An empty name makes the builder refuse, and the scoring function records "needs review" without calling the provider.

The scrubber normalises the text with NFKC (Normalization Form Compatibility Composition), then redacts emails, identifiers shaped like an NRIC or FIN (Singapore's national and foreign identification numbers), and phone numbers: "+65 9123 4567", "+6591234567", "9123-4567", and international numbers starting with a plus sign. Then it redacts the student's name and group, whole and each part with at least two letters. Matching is case-insensitive and Unicode-aware, on letter boundaries rather than the ASCII-only word boundary, so "Zoë" and "Nguyễn" are caught while "Ng" inside "ringing" is left alone. Chinese, Japanese, Thai and similar scripts do not put spaces between words, so a letter-boundary rule would never match inside "我是陈美玲同学"; for those scripts the name is matched as a plain substring.

On the way back, the validator accepts only a rubric criterion id, a score equal to that criterion's points, a feedback code from a fixed list, and optional feedback of at most 200 characters. The feedback must now also be free of control characters, line and paragraph separators, and Unicode format characters, which include bidirectional overrides and zero-width characters. A bidirectional override can make text display in a different order from how it is stored, so feedback could look like praise on screen while saying something else. Zero-width characters can hide text or smuggle markers past reviewers. Anything that fails becomes "needs review" with zero points and no model text kept. Validated feedback goes into the answer's detail column, and a student sees it only once the teacher releases results.

## Why this choice, and what the alternatives were

A policy of "remember not to send names" fails the first time someone passes a convenient object. The first design had a typed payload, but it trusted callers for the question and the system prompt, and review showed three ways round it. Building every field from ids inside the module means the only thing a caller can influence is the student's own text, and that passes through the scrubber.

The scrubber is still a best effort. It will miss a friend's name, a nickname or a home address, and a very short name part can blank an ordinary word. Stronger options, such as a named-entity model or holding AI scoring until a teacher reviews each response, cost latency and teacher time. Akmal treats consent as handled outside the app and AI scores as formative only.

Structured output is also the prompt-injection defence. A response saying "ignore the rubric" can at worst push the model to a different allowed criterion, never to invent a score or free text.

## Glossary

Provider adapter: the small object that talks to one AI service.
Payload: the data sent in a request.
JSON Schema: a standard way to describe the allowed shape of JSON data.
Structured output: a model mode that returns JSON matching a supplied schema.
NFKC: a Unicode normalization that folds look-alike forms, such as full-width letters, into standard ones.
Bidirectional override: a control character that reverses how following text is displayed.
Prompt injection: text in untrusted input that tries to override a model's instructions.
