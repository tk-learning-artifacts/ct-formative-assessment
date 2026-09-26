---
title: "The CT ontology and learning outcomes as data"
date: 2026-09-26
project: ct-formative-assessment
tags:
  - data-modeling
  - ontology
  - curriculum
  - sqlite
status: unread
---

# The CT ontology and learning outcomes as data

Think of a library. The shelves are arranged by subject, with big sections like science and history, and smaller shelves inside each one. Every book carries a label saying which shelf it belongs on. A librarian can then answer "show me everything on astronomy", and the answer includes the shelves nested under astronomy, without anyone reading each book. CT Quest now has that kind of shelving system for computational thinking (CT), and every question carries labels saying where it sits.

## What we did in this project

The shelving system is called the ontology, and it lives in a data file, backend/content/ontology.json, rather than in code. Each entry is a node with an id such as "concept.loops", a kind (concept, practice or perspective), a label, a description, a parent, a list of prerequisites, a list of sources, and an optional crosswalk.

Akmal chose to anchor it on Brennan and Resnick's 2012 framework, which splits computational thinking into three dimensions. Computational concepts are the building blocks: sequences, loops, events, parallelism, conditionals, operators and data. Computational practices are ways of working: experimenting and iterating, testing and debugging, reusing and remixing, and abstracting and modularizing. Computational perspectives are how learners see themselves and the world: expressing, connecting and questioning. Those three roots and their direct children make up the top two levels of the tree, and the content validator enforces it. Any node in those two levels must cite the Brennan and Resnick source, or the server refuses to start.

Below the top two levels, CT Quest adds finer nodes where the questions need them. Data has children for variables and state, representation (with binary, text and encryption beneath it) and data structures (with paths and routing, and searching and sorting). Operators has a logic child for AND, OR and rule priority. Testing and debugging has tracing, choosing edge cases, and reviewing AI-generated code. Reusing and remixing has translating between languages and building with AI assistants, which covers vibe coding. Questioning has a child called questioning AI output.

Nodes connect in two ways. The parent link forms the tree. Prerequisites form a second graph: loops require sequences, and reviewing AI code requires edge cases and building with AI. When the server loads the ontology, both become rows in an ontology_edges table, with the kind "parent_of" for tree links and "requires" for prerequisites. The validator rejects cycles in either graph and refuses a child whose kind differs from its parent's.

Crosswalks record where a node or question would sit in another framework, without making that framework primary. The ontology file declares the allowed values for two crosswalks from the Bebras task categorisation: an informatics domain, such as algorithms and programming, and a CT skill, such as abstraction or decomposition. Each of the 24 questions carries a Bebras category, and a typo in one is a load-time error.

Learning outcomes (LOs) live in learning-outcomes.json. Each has an id like "LO-PATH-1", a statement a teacher can read, the ontology nodes it maps to, the levels it covers (P5 to S2), and optionally the audiences it applies to: "core" for the original puzzles, "rgsynapse" for the Raffles Girls' School students who already code. A question tagged with an outcome must fall inside that outcome's level and audience bands.

At boot the server validates every content file together, then replaces the content tables in SQLite with what the files say. Those tables are ontology_nodes, ontology_edges, learning_outcomes with its node, level and audience link tables, bank_questions, and the question_nodes and question_outcomes tag tables. The files stay the source of truth. The tables exist so filters run as indexed queries.

A teacher's event filter can name audiences, levels, outcomes, ontology nodes, question types and a difficulty band. Keys combine with AND, and values inside one key combine with OR. So "levels S1 or S2, and tagged with loops" is one filter. Picking a node also matches everything beneath it. The server first walks the parent_of edges with a recursive query to expand the node into its whole subtree, then matches questions tagged with any node in that set.

## Why this choice, and what the alternatives were

Keeping the ontology as data means changing frameworks or adding a node is a content edit that the validator checks, with no code change. The alternative, hardcoding topic names in logic, was how the original app handled levels, and it is why "ALL" and "S1" were fixed strings in a list.

Brennan and Resnick was chosen over two alternatives. The Bebras two-dimensional categorisation fits the original puzzles well, but it was built to classify contest tasks, and it has little to say about practices like remixing or working with AI. The Singapore Ministry of Education (MOE) Computing syllabus matches local schools, but it is exam-oriented, and its lower-secondary coverage is thin for P5 and P6. Brennan and Resnick covers practices and perspectives, which matter most for vibe-coding students. Its weak spot is that it was written around Scratch projects, so algorithmic topics like searching or invariants have no top-level home. That is the reason for the CT Quest sub-nodes. Invariants sit under abstracting, and searching and sorting sit under data structures.

A tree plus a separate prerequisite graph is simpler than a full knowledge graph with typed relations, and it covers what the picker and reporting need. The cost is that each node has one parent, so a node that belongs in two places has to choose one. The tag tables and crosswalks cover the rest.

## Glossary

Ontology: a structured vocabulary of concepts and how they relate.
Node: one entry in the ontology.
Prerequisite edge: a "requires" link saying one idea should be learned before another.
Crosswalk: a mapping from a node or question to another framework's categories.
Learning outcome (LO): a teacher-readable statement of what a student should be able to do.
Audience: a group of students with shared background, here core or RGSynapse.
Recursive query: a query that repeats itself to walk a tree to any depth.
