---
title: Structured visuals versus generated images
date: 2026-09-27
project: ct-formative-assessment
tags: [architecture, data, accessibility, testing]
status: unread
---

## ELI5

Think of the difference between a knitting pattern and a photograph of a jumper. Anyone can check the pattern and knit it again in another wool; nobody can reliably count the stitches in the photo. CT Quest now has both kinds of picture in its questions, and it treats them very differently for exactly that reason.

A structured visual is the knitting pattern. The question file holds data, such as the rows of a maze, the points and weighted arrows of a network, the boxes and yes-or-no branches of a flowchart, or the cells of a table, and a small drawing file turns that data into a picture in the browser. There is one drawing file per kind of figure. The same file runs on the server too, where it checks the data when the server starts and writes the long text description that a screen reader reads out and that any student can open under "Describe the picture". Eleven questions got one, from the shortest-walk maze to the even-odd machine drawn as a flowchart with a loop.

A generated illustration is the photograph. Three questions for the youngest students got a small scene, a robot beside an empty snack box, a cat on a stage, a rocket on a launch pad, made once by an image model (Codex for one, Antigravity for two), looked at by eye, shrunk to a few kilobytes, and saved as a file. These are only allowed to set the scene. Nothing in them may be needed to answer.

## Deep dive

The problem with pictures in an assessment is that they can be wrong in ways nobody notices. A maze drawn by hand might have one more wall than the text says, a network diagram might drop an edge, and a generated image of "three light switches" might quietly show four. In a test, a picture that contradicts the question is worse than no picture, because the student cannot know which one to trust. So the design question was really: how do we make a figure that is guaranteed to agree with the question and its answer key?

The structured route answers that by making the figure a pure function of data that tests can read. Every question in this project already had an answer-key solver, a test that reads the question's own text and computes the answer, so a stale key gets caught. For a question with a structured visual, the solver now reads the visual's data as well and fails if it disagrees with the prompt. For the cheapest-route question, the solver parses the edge list from the prompt, builds the same list from the drawn arrows, requires them to be identical, and runs a shortest-path search on both. For the even-odd machine it goes further and actually walks the flowchart box by box, reading "Divide by 2" and "Add 3" as instructions, and requires it to land on the same number as the prose. To stop a future solver from quietly ignoring its figure, the test hands every solver a copy of the visual with its data stripped out, and the solver must throw.

The other half of the decision was where to draw. Rendering in the browser from data kept the app's rule of having no build step, let every colour be one of the Slate theme's named tokens so a retint of the page retints every figure, and meant the figure and its description come from one file and cannot drift apart. The cost is a few dozen kilobytes of script per page. The alternative weighed was rendering the SVG, the Scalable Vector Graphics format, at build time and committing the files. That is the better choice when drawing needs a heavy library, such as an automatic graph layout engine, because you pay the cost once on the author's machine. Its failure mode is drift: someone edits the question data, forgets to rebuild, and the committed picture now shows last week's maze. A third option, drawing on the server and sending finished markup, would have meant inserting unescaped HTML from an API response.

Answer safety needed care because every figure is public: the files are served to anyone, and the data travels to the student's browser. A visual reaches students through its own allowlist, so the author's note about why it exists, and the illustration's provenance, meaning which tool made it and the exact prompt, stay on the teacher's side. Image files are named after the question id, so a name can never hint at content, and they are re-encoded with every metadata chunk removed. Image generators often embed the prompt and a provenance manifest inside the file, so a test reads each image's internal chunk list and refuses anything but pixel data.

The signal for choosing between the two is simple. If a student might count, measure, follow or compare anything in the picture, it must be structured. If the picture only answers "what is this story about", an illustration is fine, provided it has no text in it and sits small beside the title rather than between the question and the options.

## Glossary

- **Structured visual**: a figure stored as data in the question and drawn by code, so tests can read the same data the student sees.
- **SVG (Scalable Vector Graphics)**: a text format for drawings made of shapes and lines, which scales without blurring and can be styled with CSS (Cascading Style Sheets).
- **Allowlist projection**: building the student's copy of a question by copying only named safe fields, so anything new is hidden by default.
- **Answer-key solver**: a test that computes a question's answer from its own content and checks the stored key agrees.
- **Raster image**: a picture stored as a grid of pixels, such as WebP or PNG (Portable Network Graphics); it cannot be checked the way data can.
- **Provenance**: the record of where something came from; here, the generator, date and prompt behind each illustration.
