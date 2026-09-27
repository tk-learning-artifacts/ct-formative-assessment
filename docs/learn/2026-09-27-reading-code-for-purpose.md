---
title: "Reading code for purpose: explain-in-plain-English questions, and checking their keys by running claims"
date: 2026-09-27
project: ct-formative-assessment
tags: [assessment-design, code-reading, question-types, testing, partial-credit]
status: unread
---

# Reading code for purpose

Picture two people handed the same recipe. The first follows it step by step and tells you exactly what ends up in the bowl this time. The second reads it through once and says "oh, that's a sponge cake". The first is tracing. The second is reading for purpose, which experienced programmers use all day when they skim a function in a review, or an AI assistant's output, and decide whether it does what was asked.

Computing-education research has a name for this gap. In the 2000s, Raymond Lister and colleagues ran a multi-country study of novice programmers and found that many students who could trace a loop line by line could not say, in one sentence, what the loop was for. They described answers using the SOLO taxonomy (Structure of the Observed Learning Outcome). A "multistructural" answer retells each line: "it sets biggest to the first item, then it goes through the list, then if n is bigger it sets biggest to n". A "relational" answer sees the whole: "it finds the largest number". Questions that draw out the relational answer became known as "explain in plain English" questions.

## What we did in CT Quest

We added a question type called code-reading. The student sees a short snippet with line numbers, a Scratch-style script for Primary 5 and 6, pseudocode for the core Secondary levels, and Python or Swift for the RGSynapse students. They pick which plain-English description says what the code does for any input. The options are written as rival relational answers, for example "the biggest number", "the first number" and "the last number". A student who only traced one run can get fooled, because on some lists all three give the same result.

Most questions add a follow-up worth one of their three points. Some follow-ups are another choice: which list would make the cat say 7, or what the Swift function returns for an empty list. Others ask which one line you would change to make the code count consonants instead of vowels, or cope with all-negative scores. The line follow-up is where reading turns into modifying. It checks that the student knows which part of the code is responsible for which behaviour. The two parts are marked separately, so a correct description with a missed follow-up still earns two of the three marks, and the released breakdown shows both parts next to the key.

Some questions also have a glossary. Words like "for each", ".append" or "return" get a dotted underline, and tapping, clicking, hovering or pressing Enter on one shows a one-line note under the code. This is scaffolding for the eleven-year-olds, so an unknown keyword does not block the reading skill being measured.

The keys are checked by running the code, not by trusting the author. Each option is a claim about behaviour, so the test suite stores, for every option, a small function saying what output that description promises for a given input. It runs a JavaScript translation of the snippet on a handful of inputs and requires exactly one claim to hold on all of them, and that claim must be the key. So the inputs must make every wrong description fail at least once. For the line follow-ups, the test replaces the key line with the intended fix and checks that the new program does the new job while the original does not. Where python3 and swift are installed, the real programs run too, so the translation cannot drift from the code students see. The earlier computed answer-key explainer covers the general idea.

## Why this shape, and what else we could have done

The obvious alternative was to reuse the existing multiple-choice type with a code block. That covers the first part and is already how several RGSynapse questions work. What it cannot do is hold a second part with its own marks, show line numbers and glossary notes, or let a teacher ask for "code reading" by name.

The second alternative, which the brief itself suggested, was to put a written "explain it in your own words" box inside the same question and have AI mark it. That is closest to Lister's original free-text format, and a free answer shows a student's thinking in a way a choice between descriptions does not. We kept the written part as a separate AI-scored open-response question instead. The AI pipeline treats each answer row as having one status (pending, scored or needs review), and a question that is half marked at once and half marked later would have meant changing the background job, the teacher override, the student's pre-release total and the teacher's marking list. Those files enforce the rule that no student personal data leaves the server. As separate questions, the written explanations inherit redaction, schema-validated model output and teacher override unchanged, and teachers opt in to them as they do for other AI questions. The trade-off is that a student cannot write an explanation of the same snippet they just chose a description for. That pairing would weaken the written answer anyway, because the right description would be sitting on screen to copy.

A third option was to have students click a line inside the code itself to answer the line follow-up. We generated radio buttons labelled "Line 3" with the line's text instead. That works with a keyboard, a screen reader and a thumb, at the cost of a longer list.

## Glossary

- **SOLO taxonomy (Structure of the Observed Learning Outcome):** a scale for how connected an answer is, from retelling parts (multistructural) to seeing how they fit into a whole (relational).
- **Explain in plain English:** a question asking what a piece of code does, in one sentence, without retelling each line.
- **Tracing:** working through code step by step for one particular input.
- **Claim:** in our tests, a function saying what output a description promises for a given input.
- **Scaffolding:** temporary support, such as the glossary notes, that lets a learner reach the skill being taught.
