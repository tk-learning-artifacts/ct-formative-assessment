# ADR 0002: Adopt Slate's visual conventions

- **Status:** Accepted, 2026-09-27 (branch `ui/slate`).
- **Scope:** Presentation only: `web/style.css`, the markup that `web/app.js`, `web/admin.js` and `web/types/*.js` render, and the two HTML shells. No API, schema or scoring change.
- **References:** Slate lives at `/Users/akmal/Projects/slate` and was read, not changed. The Slate documents cited here are its ADR 0002 (theme contract, with the 2026-08-01 amendment), 0003 (house xAPI profile), 0004 (embed contract), 0005 (distribution model), 0012 §4 (status colours), 0018 (voice enforcement) and 0021 (destructive actions), plus `registry/ui/*.tsx`, `templates/slate-static/` and `corpus/voice/voice-profile.md`.

## Context

CT Quest's pages were built as a bright, gamified hero-card layout: a purple gradient background with decorative orbs and a grid overlay, Baloo 2 and Nunito loaded from Google Fonts, 30px-radius cards nested three deep, an uppercase eyebrow above almost every heading ("CURRENT MISSION", "CHALLENGE PROGRESS", "QUESTION PROMPT"), and "mission" and "challenge" framing on the buttons. It also carried a light/dark toggle backed by `localStorage` and `prefers-color-scheme`, with a full second palette.

Three problems followed. A teacher saw one or two events at a time and had to scroll a long way to reach results; a student on a laptop usually had to scroll to get from the code to the options. The colours were hard-coded throughout (about 110 distinct `rgba()` and hex values), so any retint was a hunt. And the chrome spoke in a voice that was louder than the task: an 11-year-old sitting a formative check does not need to be told it is a mission.

Slate is Akmal's house framework for AI-authored educational software. Its visual conventions (a theme contract of named tokens, a small component registry, a light-only decision and a house voice) were written for exactly this kind of app, so we adopted them rather than inventing a third look.

## Decision

### Adopted

**The theme contract (Slate ADR 0002).** `web/style.css` has one `:root` block holding the fourteen contract tokens: seven neutrals (`--color-ink`, `--color-ink-soft`, `--color-muted`, `--color-surface`, `--color-surface-2`, `--color-line`, `--color-line-strong`), `--color-bg`, the accent trio (`--color-accent`, `--color-accent-deep`, `--color-accent-soft`) and the three fonts. Every other rule refers to these by name. There is no hex, `rgb()` or named colour anywhere else in the file, and none in the JavaScript. Tints are made with `color-mix()` over the tokens, so they follow a retint too.

We used the **house** values from the 2026-08-01 amendment (parchment `#F7F1E1` background, botanical green `#2E7D63` accent) rather than the templates' neutral placeholder. The amendment reserves the placeholder for templates that seed other people's projects; CT Quest is one of Akmal's own tools, which is what the house palette is for.

**Light only, permanently.** The toggle, the `data-theme` attribute, the `ct-quest-theme` key in `localStorage`, the dark palette and every `prefers-color-scheme` rule are gone. `:root` declares `color-scheme: light`, so form controls and scrollbars render light even on a device set to dark. Slate's reasoning (a second palette doubles the contrast checking for every change and nobody had asked for it) applies here too. The same reasoning is weaker for students on their own devices, which is listed under open questions.

**The four status tones (Slate ADR 0002 amendment, 0012 §4).** `--status-positive`, `--status-neutral`, `--status-warning` and `--status-critical`, with the amendment's values, are declared as an off-contract extension in the same `:root` block. They are mapped once:

- a correct answer, a submitted attempt, released results, an answer marked by the teacher or by AI: positive;
- an incorrect answer, a failed preview: critical;
- a late attempt, part marks, an answer that needs the teacher's mark: warning;
- an answer still being marked by AI, an attempt in progress: neutral with a hollow dot, Slate's shape for "not known yet";
- results hidden from students, a reset attempt: neutral with a filled dot.

Every status shows a word as well as a colour ("Correct", "Late", "Needs your mark"), so no state depends on colour alone.

**Contrast rules.** Slate's contrast table says plain `--color-accent` (3.87 to 4.40:1 on these backgrounds) is not for small text. All small coloured text uses `--color-accent-deep` or a status tone, each above 4.5:1. The registry's accent button fills with plain `--color-accent`; here it fills with `--color-accent-deep` instead, because its label is 15px text on the fill. Focus rings use `--color-accent-deep` at 2px. Input borders use `--color-line-strong` rather than the registry's `--color-line`, which is nearly invisible on parchment.

**The components, ported to plain CSS.** Slate ADR 0005 says shared code is copied in and owned, never installed. The registry components are React and Tailwind, and this app has neither, so we ported their look rather than their code: `.card` (Card, including `--flush` and `--raised`), `.btn` with `--primary`, `--accent`, `--secondary`, `--ghost` and `--sm` (Button), `.field` with a mono `.field__hint` (Field), `.tag` (Tag), `.section-heading` without an eyebrow (SectionHeading), the `.bar` and `.wrap` shell (PageShell), `.error-text` (ErrorText), a mono uppercase `.concept-tag` for a question's level, topic and style (ConceptTags, as spans since they link nowhere here), and a horizontal row of numbered progress dots on the question screen (ProgressNav, laid flat, filled when a question is answered and ringed for the current one). The join and sign-in cards follow ClassCodeJoin's shape: one narrow card, stacked fields, one full-width accent button. No React, Tailwind, build step or npm dependency was added.

**Fonts.** Slate ships system stacks and no web font, so the Google Fonts request is gone. Headings use Slate's `--font-serif` stack (Iowan Old Style, Palatino and fallbacks), body text `--font-sans` (the platform UI font) and code `--font-mono`.

**Destructive actions (Slate ADR 0021).** That ADR records that the contract has no destructive colour and that such controls stay app-local, where the status tones are allowed. "Reset" on an attempt and "Log out" use an app-local `.btn--destructive`: outlined, in `--status-critical`, never filled, so a column of Reset buttons stays quiet. Reset keeps its existing `confirm()`.

**Voice (Slate `corpus/voice/voice-profile.md`).** On-screen copy was rewritten to the slide register (R1): short, second person, plain. "Launch challenge" became "Start test", "Next mission" became "Next", "Submit challenge" became "Submit test", "Nice Work, Dana" became "Your answers are in, Dana". Eyebrows were removed everywhere; none carried information the heading below it did not. Teacher-facing `details` notes still never reach a student surface. We did not wire in Slate's `check-voice.mjs` (ADR 0018); see below.

### Density

This was a design choice as much as a Slate one. The base size is 15px with 1.5 line height (Slate's template uses 18px and 1.6, which suits reading pages rather than tools). Card padding went from 22 to 26px nested inside 22px to a single 16px level; radii from 18 to 34px to 6 to 8px. On a desktop the question screen puts the prompt and code beside the answer, and a sticky strip carries the question count, dots and timer. The teacher dashboard is two columns: the new-event form and a compact event list on the left, the chosen event's results on the right. The form takes the full width only while "Choose what to test" is open, with the preview pinned beside the filters. Per-outcome results became sortable tables. On a 1280 by 800 screen the teacher's first view now holds the form, three events and four attempts with their marking forms; before, it held the page header, a sign-in banner and the create form, with no events or results in sight. Everything reflows to one column at 390px with no horizontal scroll. Parsons controls keep 44px touch targets on coarse pointers.

### Deliberately not adopted

- **The records bus (Slate ADR 0003).** Out of scope for a presentation pass. The assessment below says what adopting it would take.
- **The embed contract (Slate ADR 0004).** CT Quest is a full app with its own server and auth, not an artifact hosted inside another page, so there is nothing to embed yet. A single question type (Parsons, say) could become a `<slate-*>` element later if another Slate app wanted it.
- **The registry's React code and the `slate-static` template.** Porting to React or adding Tailwind would add a build step and dependencies the constraints rule out. The look is ported; the code is not.
- **`check-voice.mjs` and its write-time hook (Slate ADR 0018).** The UI copy lives in template literals in JavaScript, which the checker's scanned roots (`src`, `client/src`) do not cover, and the copy is short enough to review by eye. Worth adding if this app grows prose surfaces.
- **ProgressNav as a navigation control.** Slate's ProgressNav links to each item. Here the dots are display only, because jumping between questions would be a behaviour change. See open questions.
- **An eyebrow on SectionHeading.** The component supports one; we never pass it.

## Consequences

- A retint is one edit: change the values in the `:root` block of `web/style.css`. Nothing else names a colour.
- The `ct-quest-theme` key stays in the `localStorage` of browsers that used the toggle. Nothing reads it, and it is harmless.
- Two small behaviour changes came with the markup: the student join and teacher sign-in panels are now `<form>` elements, so pressing Enter submits them (before, only a click did). Element ids, data attributes and API calls are unchanged. The multiple-choice options are now a `<fieldset>` with a `<legend>`, so a screen reader announces the question as a group.
- `:has()` drives two layout details (the checked MCQ option and the full-width form while the picker is open). Browsers without it (Safari before 15.4, Chrome before 105) still work; they miss the highlight and keep the narrow form.

## Later: a deeper Slate adoption (records bus)

This is an assessment only; nothing here is built.

Slate's records bus is a table of xAPI-lite statements, each an actor, a verb and an object with optional result, context and timestamp, from a closed set of house verbs, with activity ids built as `https://xapi.snack.tinkertofu.com/artifact/<app>/<activity>`. CT Quest already stores everything such statements would carry, so adoption would be an extra write path beside the existing tables rather than a rewrite.

The mapping is direct. Starting an attempt is `attempted` on the event's activity (`artifact/ct-quest/event/<joinCode>`). Resuming after a refresh is `resumed`. Each answer at submit is `answered` on the question's activity (`artifact/ct-quest/question/<id>`), with `result.response` holding the recorded response, `result.score` the earned and maximum points and `result.success` the correctness. Submitting is `completed` with the total, and a late submission is a context extension. A teacher's reset or manual mark of an AI answer is `overrode`, the house verb for overriding a system decision. The ontology nodes and learning outcomes would travel as context activities, which is what would let a Slate teacher console roll CT Quest results up beside another app's.

Three things make it more than a mapping exercise:

1. **Identity is the hard part.** Slate ADR 0003 and 0007 keep personal data off the bus: the actor is a class code plus codename, and the roster stays with the teacher. CT Quest's actor is the student's real name and class, typed at the join screen. Emitting statements as they stand would put names on the bus and break the property Slate's PDPA posture depends on. The app would need an opaque per-event handle (for example an HMAC of the `student_key` under a server secret), with the name-to-handle mapping kept only in CT Quest's own database.
2. **Release gating has to hold on the bus too.** The per-question breakdown is withheld until release to stop the repeated-attempt oracle. Statements carrying `result.success` must be readable only by the teacher, or be emitted only after release. Otherwise the bus becomes a second leak path for the answer key.
3. **AI marking is asynchronous.** An open-response `answered` statement would first go out with no score, and a later statement (or an `overrode` from the teacher) would carry the mark. Consumers would need to take the latest statement per answer.

The transport would follow ADR 0003's tier for server apps: a `statements` table written in the same transaction as `answers`, through a new timestamped migration, with the address-shaped-string guard on any free text (open-response answers are exactly where a student types their own name). The shared LRS is still unbuilt in Slate, so the first step pays off on its own: a local statements table the teacher console could later read. A rough size: one migration, one module building statements from an attempt, one test per verb, and an ADR amendment here to record the handle scheme.

## Open questions

- Light-only was decided in Slate for one teacher at one desk. Students use their own devices, some set to dark. Is light-only still right for the student page?
- Should the progress dots become buttons that jump to a question? That is a behaviour change, so it was left out.
- On a phone the teacher's results sit below the new-event form and the event list. Should results come first on small screens?
