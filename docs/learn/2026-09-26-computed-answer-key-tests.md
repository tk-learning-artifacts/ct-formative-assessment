---
title: "Computed answer-key tests: solvers as test oracles"
date: 2026-09-26
project: ct-formative-assessment
tags:
  - testing
  - test-oracles
  - content-quality
  - node-test
status: unread
---

# Computed answer-key tests: solvers as test oracles

Imagine a maths textbook whose answer section was typed by a tired assistant. You could proofread every answer by eye and still miss one. Or you could hand every problem to a calculator that works it out from the question as printed, and flag any answer that disagrees. The second approach catches errors a human reader skims past, and it catches them again every time someone edits a problem. CT Quest now has that calculator for its question bank.

## What we did in this project

Of the original 20 questions, two had wrong keys. The grid path question claimed the shortest walk was seven steps when it is six. The cheapest-route question's real answer, four, was not among the options. A third, the "larger of A and B" question, had two correct options. New content will have mistakes at a similar rate unless something checks it automatically.

Every question now has a solver in backend/test/solvers, grouped by bank: one file for the core questions, one for RGSynapse, and an index that merges them. A solver is a small function that reads the question's own text and works out the answer. The grid solver parses the ASCII grid from the question's art field and runs a breadth-first search. The weighted route solver pulls the edges and costs out of the prompt with a pattern match and runs Dijkstra's shortest-path algorithm. The neighbour-swap solver counts inversions. The Caesar cipher solver reads the shift and the coded word and decodes it. The colour-flip solver explores every reachable tile pattern and reports which counts of black tiles never appear. The solvers parse rather than restate the answer, so if someone edits a number in a prompt without updating the key, the test fails.

A solver returns either a value or a predicate. A value is matched against each option's text, either exactly (ignoring case) or by the option's leading number, so "6 steps" matches six. A predicate is a function that says whether an option is right. That suits questions like "which order always works", where the solver checks each option against the rules. Either way, the test then applies the key rule: exactly one option must match, and it must be the stored key. Zero matches means the true answer is missing from the options. Two or more means the question is ambiguous. One match that is not the key means the key is wrong.

A regression test checks that the solvers themselves work. It loads the original version 1 question bank from the migration fixture, the database dump made by the untouched main-branch code, and runs every solver against it. It asserts that exactly four questions are flagged: P5-01, P6-01, S1-01 and S2-02. Three of those were already known. P5-01 was found by the solver while this work was being built. That is the packing-order question, where "3, 1, 2" puts both items in before closing the box, just like the official answer "1, 3, 2", so two options always worked. The distractor became "3, 2, 1", and a database migration applies the same fix to existing events.

Code questions need a different approach, because the Docker image has no Python or Swift to run them. For the Python tracing questions, the solver contains a line-by-line JavaScript translation and pins the exact source code it translated. If anyone changes the Python, the solver throws, asking for the translation to be updated. Where the code has clear numbers to extract, the solver parses them instead. The Swift-to-Python question reads the stride's start, end and step, and each option's range arguments, then compares the sequences they produce.

Two further tests keep the system complete. One fails if any question has neither a solver nor an entry in a NOT_COMPUTABLE list with a written reason. The other fails if a solver refers to a question that no longer exists. The escape hatch is currently empty, and any skipped question shows up in the test output under its reason.

To add a question, write the question in the content file. Then add a function with the same id to the solver file for its bank, which reads the prompt, art or code and returns a value or a predicate. Run npm test.

## Why this choice, and what the alternatives were

The plain alternative is a snapshot test that stores the expected key. It would only confirm that the key has not changed, and that is useless here, because the keys were wrong in the first place. A test oracle computes the right answer independently, which is what content checking needs.

Parsing the question text makes solvers somewhat brittle. Rewording a prompt can break a pattern match even when the key is fine. That brittleness was accepted on purpose. A broken solver fails loudly with a message naming what it could not find, and fixing it takes a minute. A wrong key reaching students costs far more.

A heavier option would be a structured, machine-readable problem spec for each question, from which both the prompt and the answer are generated. That removes the parsing, but it makes authoring harder for teachers, and it does not fit free-form puzzles. It may be worth revisiting for high-volume families like code tracing.

## Glossary

Test oracle: an independent way of deciding the correct result, used to judge the system under test.
Solver: in this project, a function that computes a question's answer from its text.
Predicate: a function that returns true or false for a given input.
Breadth-first search (BFS): exploring a grid or graph layer by layer, which finds shortest paths when every step costs the same.
Dijkstra's algorithm: a method for finding the cheapest path when steps have different costs.
Inversion: a pair of items in the wrong order. The number of inversions is the minimum number of neighbour swaps needed to sort.
