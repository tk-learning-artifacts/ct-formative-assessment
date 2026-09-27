---
title: "Sending questions one at a time, and polling a status view"
date: 2026-09-27
project: ct-formative-assessment
tags:
  - api-design
  - assessment-design
  - polling
  - security
status: unread
---

Picture an exam hall where the invigilator hands out one sheet at a time and takes it back before giving the next. Nobody can read ahead, because the later sheets are still on the invigilator's desk. In another hall everyone gets the whole booklet and is asked not to turn the page. CT Quest's in-order tests used to work like the second hall, and now work like the first. A second change, to how the page checks for updates, also cuts down what the browser receives.

## What we actually did

Under "in order" navigation, a student answers or skips each question before moving on and can never go back. Until now the page still downloaded every question at the start and simply did not show the later ones. Anyone who opened the browser's developer tools could read the whole test, and could pass the later questions to a friend who had not started yet. Now the server sends only what the student has reached. Starting an attempt sends the first question. Each commit (answering or skipping a question for good) returns the next question in a field called next. Resuming after a refresh sends the committed questions plus the current one. The responses also carry questionCount, the number of questions in the test, so the progress strip can still draw a dot for every question, including the ones not sent yet.

The rule is a single function in policy.js, deliveredQuestionCount. Under free navigation it returns every question. Under in-order navigation it returns the number committed plus one. The same count applies after submit, because answers stored at submit are not commits, so a student who stopped at question three never receives the text of questions four and five. The breakdown is a separate rule: once it is visible (on release, or straight after submit when the teacher chose feedback after each question or at the end), it lists every question by title with its answer, including ones the student never reached. So a student who submits early under those settings still sees the remaining keys, the same trade-off those feedback settings already make.

One case needed care. A teacher can switch an event from free to in order while students are working. A student who started under free already downloaded every question, and nothing can take that back. So the server checks the event's settings history. If the navigation changed away from free after this attempt started, the attempt keeps every question. Only attempts started under in order are staged. Switching back to free sends every question on the student's next full read.

The second change is about polling, where the page repeatedly asks the server "has anything changed?" Every 30 seconds, and after every move, the student page re-read the whole attempt, questions included. That was how a teacher's mid-test change to the settings or the deadline reached the student. Now the page asks for a status view, the same address with fields=status added. That response carries only the settings, the deadline, which answers are committed and how far their marking has got, and the total the policy allows. It has no question text, no answer key and no feedback. The page compares it with what it already holds, and fetches the full attempt only when something differs. A test builds every kind of status response and checks for a list of forbidden fields, and that no question's prompt appears anywhere in the body.

## Why this choice, and what the alternatives were

For staged delivery, the alternative was to keep sending everything and rely on the page to hide it. That is cheaper, and it survives a lost network response more gracefully, because the next question is already in memory. But it does not enforce anything, and anything a browser receives, a student can read. With staged delivery, the only cost is that a lost commit response leaves the page without the next question. The page already handles that case: the retry gets "answer locked", and the page re-reads the attempt, which now brings the missing question with it.

A third design would send each question by id on request. It was not chosen because the ids themselves say something (P5 or S2, for instance), and the server would need to check each request against the student's position anyway. The count-based rule answers "what may this student hold?" in one place.

For the status view, the main alternative was a separate endpoint, such as a status sub-path. A query parameter on the existing route was chosen because it reuses the same token check and the same "not found" answer for a wrong token, so the guard cannot drift between two routes. An unknown fields value gets a 400 rather than being ignored, so a typo cannot quietly fall back to the full download. Other options were push updates over WebSockets or server-sent events, or HTTP's own conditional requests, where the server sends an ETag, a fingerprint of the response, and the client asks "only if it changed". Push would cut polling to zero but needs long-lived connections through the school's network. Conditional requests save bandwidth only when nothing changed, and the server still builds the full response to fingerprint it. For a class of 40, one small request every 30 seconds per student is under two requests a second, which a single Node process handles easily.

One thing is lost: an event's title is not in the status view, so a teacher's rename reaches the student only on their next full read.

## Glossary

Staged delivery: sending test content only as the student reaches it.
Commit: recording an answer, or a skip, as final before submitting.
Polling: the client asking the server at intervals whether anything has changed.
Status view: a small response describing the state of an attempt without its content.
ETag (entity tag): a fingerprint of a response that lets a client ask for it only if it changed.
Server-sent events: a one-way stream from server to browser over a long-lived HTTP connection.
