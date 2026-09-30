(function () {
  const screen = document.getElementById("screen");
  const TOKEN_KEY = "ct-quest-token";
  const PREVIEW_DEBOUNCE_MS = 300;

  const state = {
    token: localStorage.getItem(TOKEN_KEY),
    user: null,
    events: [],
    selectedEventId: null,
    // What the main area shows: "event" (the chosen event), "create" (the
    // new-event form), "bank" (the whole question bank) or null (a prompt to
    // pick one). On a phone the event
    // list is hidden while a view is open, with a link back to it.
    view: null,
    results: null,
    outcomesSummary: null,
    outcomesSort: { key: "meanPercentage", dir: "asc" },
    // Which results sections (and the tables and previews nested in them)
    // are open, by data-section key. Kept across re-renders, such as after a
    // mark is saved, and in localStorage between visits.
    openSections: loadOpenSections(),
    // The attempt shown in the per-student dialog, or null. Kept in state so
    // the dialog reopens after a re-render (a saved mark reloads the results).
    openAttemptId: null,
    // The question rows expanded in that dialog.
    openAnswerRows: new Set(),
    // Advanced-picker reference data. null until loaded; catalogFailed marks a
    // failed fetch so the page falls back to the simple form instead of
    // showing a broken picker.
    catalog: null,
    ontology: null,
    outcomes: null,
    catalogFailed: false,
    // Quick setup: the presets from GET /api/presets, and the teacher's
    // choice of card and knobs ({ id, who?, emphasis?, length? }). If the
    // presets cannot load, the form falls back to the legacy question set.
    presets: null,
    presetsFailed: false,
    quick: null,
    // The advanced picker's own selections, kept across re-renders. Choosing
    // a preset fills them, so "Customise" starts from the preset.
    picker: {
      audience: "core",
      levels: [],
      outcomes: [],
      nodes: [],
      types: [],
      difficultyMin: "",
      difficultyMax: "",
      limit: ""
    },
    // Set once the teacher changes anything in Customise, and cleared when
    // they choose a card or knob. While set, a preset preview leaves the
    // picker alone, so closing Customise keeps their edits.
    pickerEdited: false,
    // Whether the chosen event's "Edit settings" form is open.
    editingSettings: false,
    // An admin's event list filter (ADR 0004): every teacher's events or
    // only their own, and optionally one teacher's (by email).
    eventFilter: {
      scope: "all",
      owner: ""
    },
    // The event settings (ADR 0003), kept across re-renders.
    settings: {
      feedbackMode: "release",
      navigationMode: "free"
    },
    preview: null,
    previewError: null,
    previewLoading: false,
    // Whether the create-event preview shows the compact question list
    // (fetched with include: "questions", full teacher views) instead of the
    // plain title list.
    previewQuestionsOpen: false,
    // Whether state.preview.questions (whatever is currently held) was
    // fetched with include: "questions". previewQuestionsOpen can flip
    // before that fetch resolves, so the render must check this too, or a
    // stale summary-shaped list gets rendered as full teacher views.
    previewIncludesQuestions: false,
    // The chosen event's frozen question snapshot (full teacher views), or
    // null until GET /api/events/:id/questions has loaded.
    eventQuestions: null,
    // The whole question bank as entries from GET /api/question-bank (view
    // "bank"), loaded once on first open and again after a change, and the
    // teacher's filters over it. Filtering runs in the page, since the bank
    // is small. bankSelected is the id shown in the review pane (also kept
    // in the URL hash); bankShowAnswer keeps the answer key open across
    // questions.
    bank: null,
    bankError: null,
    bankSelected: null,
    bankShowAnswer: false,
    bankFilter: { audience: "", level: "", type: "", status: "", outcome: "", q: "" }
  };

  const FEEDBACK_LABELS = {
    each: "Feedback after each question",
    end: "Feedback at the end",
    release: "Feedback when released"
  };

  const NAVIGATION_LABELS = {
    free: "Free navigation",
    linear: "In order, no going back"
  };

  // Short audience names for the compact event rows.
  const AUDIENCE_SHORT = {
    core: "Core",
    rgsynapse: "RGSynapse"
  };

  // Loosest to strictest: "each" shows a result immediately, "release" holds
  // it back until the teacher acts. Used to warn a teacher editing a live
  // event only when their change tightens the mode, never when it loosens it.
  const FEEDBACK_STRICTNESS = { each: 0, end: 1, release: 2 };

  function tightensFeedback(from, to) {
    return FEEDBACK_STRICTNESS[to] > FEEDBACK_STRICTNESS[from];
  }

  // Shown under the feedback setting when it reveals the key to a student
  // before everyone has finished.
  const FEEDBACK_WARNINGS = {
    each: "Each student sees the correct answer as soon as they check a question, and their answer then locks. In a live session, answers can spread to classmates who are still working.",
    end: "Each student sees the correct answers as soon as they submit. In a live session, answers can spread to classmates who are still working."
  };

  let previewTimer = null;
  let previewRequestId = 0;

  // Loading cue: a thin bar under the header while any request is in flight.
  // It only appears after LOADING_DELAY_MS so quick requests never flash it.
  const LOADING_DELAY_MS = 150;
  let inFlight = 0;
  let loadingTimer = null;

  function loadingStart() {
    inFlight += 1;

    if (inFlight === 1 && !loadingTimer) {
      loadingTimer = setTimeout(() => {
        loadingTimer = null;
        if (inFlight > 0) {
          document.body.dataset.loading = "true";
        }
      }, LOADING_DELAY_MS);
    }
  }

  function loadingEnd() {
    inFlight = Math.max(0, inFlight - 1);

    if (inFlight === 0) {
      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
      delete document.body.dataset.loading;
    }
  }

  // Runs fn while the button shows a busy state: aria-busy, disabled and a
  // label such as "Saving…". Restored afterwards if the button is still on
  // the page (most handlers re-render, which replaces it anyway).
  async function withBusy(button, fn, busyLabel) {
    if (!button) {
      return fn();
    }

    if (button.getAttribute("aria-busy") === "true") {
      return undefined;
    }

    const label = button.textContent;
    button.setAttribute("aria-busy", "true");
    button.disabled = true;

    if (busyLabel) {
      button.textContent = busyLabel;
    }

    try {
      return await fn();
    } finally {
      if (button.isConnected) {
        button.removeAttribute("aria-busy");
        button.disabled = false;
        button.textContent = label;

        if (button.id === "createEventBtn") {
          updateCreateButtonState();
        }
      }
    }
  }

  // Placeholder blocks shown while data loads. Sizes come from CSS.
  function skeletonRows(count) {
    return Array.from({ length: count }, () => `<div class="skeleton-b sk-row"></div>`).join("");
  }

  function skeletonMainHtml() {
    return `
      <div class="sk-main" role="status" aria-live="polite">
        <span class="visually-hidden-b">Loading&hellip;</span>
        <div class="skeleton-b sk-head"></div>
        <div class="skeleton-b sk-subhead"></div>
        <div class="sk-attempts">${skeletonRows(4)}</div>
        <div class="skeleton-b sk-chart"></div>
        <div class="skeleton-b sk-chart"></div>
      </div>
    `;
  }

  function skeletonSideHtml() {
    return `<div class="sk-side card card--flush" role="status"><span class="visually-hidden-b">Loading events&hellip;</span>${skeletonRows(5)}</div>`;
  }

  function skeletonDashboardHtml() {
    return `
      <div class="dash">
        <nav class="dash__side" aria-label="Events">${skeletonSideHtml()}</nav>
        <div class="dash__main">${skeletonMainHtml()}</div>
      </div>
    `;
  }

  async function api(path, options) {
    loadingStart();

    try {
      return await apiRequest(path, options);
    } finally {
      loadingEnd();
    }
  }

  async function apiRequest(path, options) {
    const headers = new Headers(options && options.headers ? options.headers : {});
    headers.set("Content-Type", "application/json");

    if (state.token) {
      headers.set("Authorization", `Bearer ${state.token}`);
    }

    const response = await fetch(path, {
      ...options,
      headers
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    return payload;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  const AI_REASONS = {
    "ai-disabled": "AI is off (AI_PROVIDER=none)",
    "provider-error": "the AI service did not answer",
    "invalid-output": "the AI's reply failed validation",
    "payload-rejected": "the answer could not be prepared for AI",
    "job-error": "the scoring job failed"
  };

  // Status line for an AI-scored answer, for the teacher only, with the
  // status tone it is drawn in. On an event the reader cannot change (an
  // admin on another teacher's event) the mark is the owner's, not theirs.
  function aiStatus(answer, canManage) {
    const detail = answer.detail || {};

    if (detail.review) {
      return { tone: "positive", text: `Marked by ${canManage ? "you" : "the teacher"}: ${detail.review.score}/${answer.maxPoints}` };
    }

    if (answer.scoreStatus === "pending") {
      return { tone: "pending", text: "Being marked by AI" };
    }

    if (answer.scoreStatus === "needs-review") {
      return { tone: "warning", text: `Needs ${canManage ? "your" : "the teacher's"} mark: ${AI_REASONS[detail.reason] || "AI could not score it"}` };
    }

    if (detail.ai === "scored") {
      return { tone: "positive", text: `AI scored ${answer.earnedPoints}/${answer.maxPoints} (criterion "${detail.criterionId}", ${detail.feedbackCode})` };
    }

    return { tone: "neutral", text: answer.response ? `Scored ${answer.earnedPoints}/${answer.maxPoints}` : "No answer" };
  }

  // One AI-scored answer, with a small form to set the score and feedback.
  // Shown in the per-student dialog, on that question's row. A committed
  // answer can be marked before the student submits, so under "after each
  // question" they see the mark straight away.
  function aiAnswerReview(attempt, answer, canManage) {
    return [answer]
      .map(answer => {
        const detail = answer.detail || {};
        const aiFeedback = detail.ai === "scored" && detail.feedback ? detail.feedback : "";
        const reviewFeedback = detail.review && detail.review.feedback ? detail.review.feedback : "";
        const key = escapeHtml(`${attempt.id}-${answer.questionId}`);
        const status = aiStatus(answer, canManage);

        return `
          <div class="ai-review ${status.tone === "warning" ? "ai-review--attention" : ""}">
            <div class="row">
              <strong class="mono small">${escapeHtml(answer.questionId)}</strong>
              <span class="tag status status--${status.tone}">${escapeHtml(status.text)}</span>
            </div>
            <p class="ai-review__answer">${escapeHtml(answer.response && answer.response.text ? answer.response.text : "No answer")}</p>
            ${aiFeedback ? `<p class="muted small">AI feedback: ${escapeHtml(aiFeedback)}</p>` : ""}
            ${canManage && !attempt.reset_at && (attempt.status === "submitted" || answer.committedAt) ? `
              <div class="ai-review__form">
                <div class="field">
                  <label for="score-${key}">Score</label>
                  <span class="ai-review__score">
                    <input id="score-${key}" type="number" min="0" max="${answer.maxPoints}" step="1" value="${answer.earnedPoints}" />
                    <span>/ ${answer.maxPoints}</span>
                  </span>
                </div>
                <div class="field field--feedback">
                  <label for="feedback-${key}">Feedback for the student <span class="field__hint">optional</span></label>
                  <textarea id="feedback-${key}" maxlength="500" rows="1">${escapeHtml(reviewFeedback)}</textarea>
                </div>
                <button class="btn btn--secondary" data-review-attempt="${attempt.id}" data-review-question="${escapeHtml(answer.questionId)}" data-review-key="${key}">Save mark</button>
              </div>
            ` : ""}
          </div>
        `;
      }).join("");
  }

  // ---------- Compact question preview ----------
  // A read-only, collapsed-by-default view of a question list, built from a
  // teacher view (full content, answer key included: GET /api/events/:id/questions,
  // or POST /api/question-bank/preview with include: "questions"). Used in the
  // create-event preview panel and the results view's Questions disclosure.
  // Static markup only, in this file: it borrows web/types/ class names for a
  // consistent look but none of their interactive code, since nothing here is
  // ever answered.

  const QP_TYPE_LABELS = {
    mcq: "Multiple choice",
    "code-trace": "Code trace",
    parsons: "Parsons problem",
    "code-reading": "Code reading",
    blocks: "Block program",
    "open-response-ai": "Open response (AI scored)",
    "multi-select": "Multiple select",
    "short-answer": "Short answer"
  };

  const QP_EXPECT_TEXT = {
    reachGoal: () => "end on the flag",
    collectAll: () => "pick up every star",
    say: value => `say ${value} at the end`
  };

  const QP_FACING_ARROWS = { north: "▲", east: "▶", south: "▼", west: "◀" };

  // Question visuals (ADR 0007), drawn with the same kind files as the
  // student page. The kinds load once, before the first render.
  const Visuals = window.CTQuestVisuals;
  const visualsReady = Visuals ? Visuals.load().catch(() => null) : Promise.resolve();

  const QP_VISUAL_PURPOSES = {
    information: "needed to answer",
    "reading-load": "restates the prompt, to cut reading",
    context: "sets the scene only"
  };

  function qpFigure(question) {
    if (!question.visual) {
      return "";
    }

    const figure = Visuals && Visuals.get(question.visual.kind)
      ? Visuals.figure(question.visual, { id: `qp-${question.id}` })
      : "";

    if (!figure) {
      return `<p class="muted small">This question has a ${escapeHtml(question.visual.kind)} figure, which could not be drawn here.</p>`;
    }

    return Visuals.placement(question.visual) === "aside" ? `${figure}<div class="qv-clear"></div>` : figure;
  }

  // Teacher only: why the visual is there, and where an illustration came
  // from (generator, date, the prompt used).
  function qpVisualNote(visual) {
    const purpose = QP_VISUAL_PURPOSES[visual.purpose] || visual.purpose;
    const note = [`<p class="small">Figure: ${escapeHtml(visual.kind)}, ${escapeHtml(purpose)}.</p>`];

    if (visual.source) {
      note.push(`<p class="small">Illustration made with ${escapeHtml(visual.source.generator)} on ${escapeHtml(visual.source.date)}${visual.source.reviewed ? " and reviewed before use" : ""}. Prompt used: ${escapeHtml(visual.source.prompt)}</p>`);
    }

    return note.join("");
  }

  // A code-reading follow-up key: one option index, or one or more lines.
  function qpFollowUpKeys(question) {
    return [].concat(question.answer.followUp);
  }

  function qpCodeLine(question, line) {
    return question.code.source.split("\n")[line - 1] || "";
  }

  function truncate(text, max) {
    const flat = String(text).replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  }

  // marking flags in words, for code-trace and parsons.
  function qpMarkingText(question) {
    const marking = question.marking;

    if (!marking) {
      return "";
    }

    if (question.type === "code-trace") {
      const bits = [];
      if (marking.collapseSpaces) {
        bits.push("runs of spaces count as one");
      }
      bits.push(marking.partial === "lines" ? "partial credit per matching line" : "all or nothing");
      return bits.join("; ");
    }

    if (question.type === "parsons") {
      return marking.partial === "longest-run" ? "partial credit for the longest correct run" : "all or nothing";
    }

    if (question.type === "blocks") {
      return marking.partial === "cases" ? "partial credit for the share of grids passed" : "all or nothing";
    }

    return "";
  }

  function qpRubricTable(rubric) {
    const rows = rubric.map(criterion => `
      <tr>
        <td class="mono">${escapeHtml(criterion.id)}</td>
        <td>${escapeHtml(criterion.description)}</td>
        <td>${criterion.points}</td>
      </tr>
    `).join("");

    return `
      <div class="table-wrap">
        <table class="data-table qp-rubric">
          <caption>Rubric</caption>
          <thead><tr><th scope="col">Criterion</th><th scope="col">Description</th><th scope="col">Points</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function qpMarkedOptions(options, key) {
    return options.map((option, i) => `
      <label class="opt qp-opt">
        <input type="radio" disabled ${i === key ? "checked" : ""} />
        <span class="opt__text">${escapeHtml(option)}</span>
        ${i === key ? `<span class="tag tag--accent">Correct</span>` : ""}
      </label>
    `).join("");
  }

  function qpPoints(n) {
    return `${n} pt${n === 1 ? "" : "s"}`;
  }

  // Code reading: the description options, then the follow-up (choice
  // options, or the line or lines that earn the mark), each part with its
  // points, and the glossary notes the student can open.
  function qpCodeReadingBody(question) {
    const followUp = question.followUp;
    const describePoints = question.points - (followUp ? followUp.points : 0);
    const parts = [
      `<p class="answer-label">What does the code do? <span class="muted small">${qpPoints(describePoints)}</span></p>`,
      `<div class="options">${qpMarkedOptions(question.options, question.answer.index)}</div>`
    ];

    if (followUp) {
      parts.push(`<p class="answer-label mt-s">${escapeHtml(followUp.prompt)} <span class="muted small">${qpPoints(followUp.points)}</span></p>`);

      if (followUp.kind === "choice") {
        parts.push(`<div class="options">${qpMarkedOptions(followUp.options, question.answer.followUp)}</div>`);
      } else {
        const lines = qpFollowUpKeys(question).map(line => `
          <li class="pa-line"><code class="pa-text">${line}: ${escapeHtml(qpCodeLine(question, line).trim())}</code><span class="tag tag--accent">Correct</span></li>
        `).join("");
        parts.push(`<p class="muted small">The student picks a line of the code. Accepted:</p><ul class="pa-list">${lines}</ul>`);
      }
    }

    if (question.glossary && question.glossary.length) {
      parts.push(`
        <p class="code-label mt-s">Glossary notes</p>
        <dl class="qp-glossary">${question.glossary.map(entry => `<dt class="mono">${escapeHtml(entry.term)}</dt><dd>${escapeHtml(entry.note)}</dd>`).join("")}</dl>
      `);
    }

    return parts.join("");
  }

  // One grid as text, the sprite drawn as an arrow where it starts, and what
  // the program must do there.
  function qpStage(stage, label) {
    const rows = stage.grid.map((row, y) => (y === stage.start.y
      ? `${row.slice(0, stage.start.x)}${QP_FACING_ARROWS[stage.start.facing] || "@"}${row.slice(stage.start.x + 1)}`
      : row));
    const expect = Object.keys(stage.expect || {})
      .filter(key => QP_EXPECT_TEXT[key])
      .map(key => QP_EXPECT_TEXT[key](stage.expect[key]))
      .join(", ");

    return `
      <div class="qp-stage">
        <p class="code-label">${escapeHtml(label)}${expect ? `: ${escapeHtml(expect)}` : ""}</p>
        <pre class="codebox qp-grid">${escapeHtml(rows.join("\n"))}</pre>
      </div>
    `;
  }

  // Blocks: what a student is given (the example grid, the starting program,
  // the toolbox and limits). The hidden grids and the solution are teacher
  // only, below.
  function qpBlocksBody(question) {
    const limits = [`${question.stepLimit || 500} steps`];

    if (question.maxBlocks) {
      limits.push(`at most ${question.maxBlocks} blocks`);
    }

    const programText = question.programText || {};

    return `
      <p class="muted small">Grid key: <code>#</code> wall, <code>.</code> floor, <code>G</code> flag, <code>*</code> star; the arrow is the sprite, facing the way it points.</p>
      <div class="qp-stages">${qpStage(question.example, "Example grid (shown to students)")}</div>
      ${programText.start ? `<p class="code-label">Starting program (given blocks cannot move)</p><pre class="codebox">${escapeHtml(programText.start)}</pre>` : ""}
      <p class="small">Toolbox: ${question.toolbox.map(type => `<code>${escapeHtml(type)}</code>`).join(", ")}${question.variables && question.variables.length ? `. Variables: ${question.variables.map(name => `<code>${escapeHtml(name)}</code>`).join(", ")}` : ""}. Limit: ${limits.join(", ")}.</p>
    `;
  }

  // The question as a student would see it, with the correct option or lines
  // marked, per type.
  function qpTypeBody(question) {
    if (question.type === "mcq") {
      const options = question.options.map((option, i) => `
        <label class="opt qp-opt">
          <input type="radio" disabled ${i === question.answer.index ? "checked" : ""} />
          <span class="opt__text">${escapeHtml(option)}</span>
          ${i === question.answer.index ? `<span class="tag tag--accent">Correct</span>` : ""}
        </label>
      `).join("");

      return `<p class="answer-label">Options, correct one marked</p><div class="options">${options}</div>`;
    }

    if (question.type === "code-trace") {
      return `<p class="answer-label">Correct output</p><pre class="codebox">${escapeHtml(question.answer.output)}</pre>`;
    }

    if (question.type === "parsons") {
      const positionOf = new Map(question.answer.order.map((id, i) => [id, i + 1]));
      const lines = question.lines.map(line => {
        const position = positionOf.get(line.id);
        const badge = position ? `<span class="tag tag--accent">${position}</span>` : `<span class="tag">distractor</span>`;
        return `<li class="pa-line"><code class="pa-text">${escapeHtml(line.text)}</code>${badge}</li>`;
      }).join("");
      const target = question.expectedOutput
        ? `<p class="code-label">Program output</p><pre class="codebox">${escapeHtml(question.expectedOutput)}</pre>`
        : "";

      return `<p class="answer-label">Lines, correct order marked</p><ol class="pa-list">${lines}</ol>${target}`;
    }

    if (question.type === "code-reading") {
      return qpCodeReadingBody(question);
    }

    if (question.type === "blocks") {
      return qpBlocksBody(question);
    }

    if (question.type === "open-response-ai") {
      const max = question.responseMaxChars || 1000;
      return `<p class="muted small">Free text, up to ${max} characters. Scored by AI against the rubric below.</p>`;
    }

    return "";
  }

  // The teacher-only material below the student-shaped view: the "details"
  // focus note, and whatever else a type keeps server-only (rubric, accepted
  // alternate outputs, marking flags).
  function qpTeacherOnly(question) {
    const bits = [];

    if (question.details) {
      bits.push(`<p>${escapeHtml(question.details)}</p>`);
    }

    if (question.visual) {
      bits.push(qpVisualNote(question.visual));
    }

    if (question.type === "code-trace") {
      if (question.answer.accepted && question.answer.accepted.length) {
        bits.push(`<p class="small">Also accepted: ${question.answer.accepted.map(form => `<code>${escapeHtml(form)}</code>`).join(", ")}</p>`);
      }
      const marking = qpMarkingText(question);
      if (marking) {
        bits.push(`<p class="small">Marking: ${marking}</p>`);
      }
    }

    if (question.type === "parsons") {
      const marking = qpMarkingText(question);
      if (marking) {
        bits.push(`<p class="small">Marking: ${marking}</p>`);
      }
    }

    if (question.type === "code-reading" && question.followUp) {
      bits.push(`<p class="small">Marking: each part all or nothing, so a right description with a missed follow-up keeps its ${qpPoints(question.points - question.followUp.points)}.</p>`);
    }

    if (question.type === "blocks") {
      const cases = question.cases || [];
      const programText = question.programText || {};

      bits.push(cases.length
        ? `<p class="small">Also marked on ${cases.length} hidden grid${cases.length === 1 ? "" : "s"}, never sent to students:</p><div class="qp-stages">${cases.map((stage, i) => qpStage(stage, `Hidden grid ${i + 1}`)).join("")}</div>`
        : `<p class="small">Marked on the example grid only.</p>`);

      if (programText.solution) {
        bits.push(`<p class="code-label">Reference solution</p><pre class="codebox">${escapeHtml(programText.solution)}</pre>`);
      }

      if (programText.solutionPython) {
        bits.push(`<p class="code-label">Reference solution as Python${question.showPython ? "" : " (students are not offered the Python view on this question)"}</p><pre class="codebox">${escapeHtml(programText.solutionPython)}</pre>`);
      }

      bits.push(`<p class="small">Marking: ${qpMarkingText(question) || "all or nothing"}.</p>`);
    }

    if (question.type === "open-response-ai") {
      bits.push(qpRubricTable(question.rubric));
    }

    if (!bits.length) {
      return "";
    }

    return `<div class="qp-teacher"><p class="qp-teacher__label"><span class="tag">Teacher only</span></p>${bits.join("")}</div>`;
  }

  function qpQuestionBody(question) {
    const parts = [`<p class="prompt-text">${escapeHtml(question.prompt)}</p>`, qpFigure(question)];

    if (question.art) {
      parts.push(`<pre class="codebox">${escapeHtml(question.art)}</pre>`);
    }

    if (question.code && question.type === "code-reading") {
      // Numbered, since a line follow-up names lines by number.
      const lines = question.code.source.split("\n").map((line, i) =>
        `<span class="ct-line"><span class="ct-line__no" aria-hidden="true">${i + 1}</span><span class="ct-line__text">${escapeHtml(line) || " "}</span></span>`).join("");
      parts.push(`<p class="code-label">${escapeHtml(question.code.language)}</p><pre class="codebox ct-code"><code>${lines}</code></pre>`);
    } else if (question.code) {
      parts.push(`<p class="code-label">${escapeHtml(question.code.language)}</p><pre class="codebox">${escapeHtml(question.code.source)}</pre>`);
    }

    parts.push(qpTypeBody(question));
    parts.push(qpTeacherOnly(question));

    return parts.join("");
  }

  function qpRow(question, number, options = {}) {
    return `
      <li>
        <details class="qp-row">
          <summary>
            <span class="qp-row__num">${number}.</span>
            <span class="qp-row__title">${escapeHtml(question.title)}</span>
            ${options.showId ? `<span class="muted small mono">${escapeHtml(question.id)}</span>` : ""}
            <span class="tag">${escapeHtml(QP_TYPE_LABELS[question.type] || question.type)}</span>
            <span class="concept-tag">${escapeHtml(question.level)}</span>
            <span class="muted small">${question.points} pt${question.points === 1 ? "" : "s"}</span>
          </summary>
          <div class="qp-row__body">${qpQuestionBody(question)}</div>
        </details>
      </li>
    `;
  }

  // questions: full teacher views, in the order they should be numbered.
  function renderQuestionPreview(questions, options = {}) {
    if (!questions || !questions.length) {
      return `<p class="muted small">No questions to show.</p>`;
    }

    return `
      <div class="qp">
        <div class="qp__controls">
          <button type="button" class="btn btn--ghost btn--sm" data-qp-expand-all>Expand all</button>
          <button type="button" class="btn btn--ghost btn--sm" data-qp-collapse-all>Collapse all</button>
        </div>
        <ol class="qp-list">${questions.map((question, i) => qpRow(question, i + 1, options)).join("")}</ol>
      </div>
    `;
  }

  // container: the element renderQuestionPreview's markup was just inserted
  // into. Re-bind after every re-render, as the rest of the page does.
  function bindQuestionPreviewEvents(container) {
    if (!container) {
      return;
    }

    const expandAll = container.querySelector("[data-qp-expand-all]");
    const collapseAll = container.querySelector("[data-qp-collapse-all]");

    if (expandAll) {
      expandAll.addEventListener("click", () => {
        container.querySelectorAll(".qp-row").forEach(details => { details.open = true; });
      });
    }

    if (collapseAll) {
      collapseAll.addEventListener("click", () => {
        container.querySelectorAll(".qp-row").forEach(details => { details.open = false; });
      });
    }
  }

  function renderLogin(errorMessage) {
    screen.innerHTML = `
      <section class="card join">
        <form class="stack" id="loginForm" novalidate>
          <div class="section-heading">
            <h2>Teacher sign-in</h2>
            <p>Sign in to create tests and see your students' results.</p>
          </div>

          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" autocomplete="username" />
          </div>

          <div class="field">
            <label for="password">Password</label>
            <input id="password" type="password" autocomplete="current-password" />
          </div>

          ${errorMessage ? `<p class="error-text" role="alert">${escapeHtml(errorMessage)}</p>` : ""}

          <button type="submit" class="btn btn--accent btn--block" id="loginBtn">Sign in</button>
        </form>
      </section>
    `;

    // A form, so Enter in either field signs in too.
    document.getElementById("loginForm").addEventListener("submit", async event => {
      event.preventDefault();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;

      await withBusy(document.getElementById("loginBtn"), async () => {
        try {
          const payload = await api("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
          });

          state.token = payload.token;
          state.user = payload.user;
          localStorage.setItem(TOKEN_KEY, payload.token);
          await loadDashboard();
        } catch (error) {
          renderLogin(error.message);
        }
      }, "Signing in\u2026");
    });
  }

  // ---------- Advanced picker: building the filter from picker state ----------

  function audienceLevels(audienceId) {
    const audience = state.catalog && state.catalog.audiences.find(item => item.id === audienceId);
    return audience ? audience.levels : [];
  }

  // The filter the advanced picker currently describes. difficulty keys are
  // only included when the teacher set them, matching selection.js's shape.
  function pickerFilter() {
    const filter = {
      audiences: [state.picker.audience],
      levels: state.picker.levels.slice(),
      outcomes: state.picker.outcomes.slice(),
      nodes: state.picker.nodes.slice(),
      types: state.picker.types.slice()
    };

    const min = state.picker.difficultyMin ? Number(state.picker.difficultyMin) : null;
    const max = state.picker.difficultyMax ? Number(state.picker.difficultyMax) : null;
    const limit = state.picker.limit ? Number(state.picker.limit) : null;

    if (min || max) {
      filter.difficulty = {};
      if (min) {
        filter.difficulty.min = min;
      }
      if (max) {
        filter.difficulty.max = max;
      }
    }

    if (limit) {
      filter.limit = limit;
    }

    return filter;
  }

  // Sets the advanced picker to a filter, such as the one a preset compiles
  // to. Presets always compile to one audience, which the picker needs.
  function fillPickerFromFilter(filter) {
    state.picker = {
      audience: (filter.audiences && filter.audiences[0]) || "core",
      levels: (filter.levels || []).slice(),
      outcomes: (filter.outcomes || []).slice(),
      nodes: (filter.nodes || []).slice(),
      types: (filter.types || []).slice(),
      difficultyMin: filter.difficulty && filter.difficulty.min ? String(filter.difficulty.min) : "",
      difficultyMax: filter.difficulty && filter.difficulty.max ? String(filter.difficulty.max) : "",
      limit: filter.limit ? String(filter.limit) : ""
    };
  }

  function schedulePreview() {
    if (previewTimer) {
      clearTimeout(previewTimer);
    }

    state.previewLoading = true;
    previewTimer = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS);
  }

  // Previews what the event would contain: the advanced picker's filter while
  // it is open, otherwise the quick setup choice. A preset preview returns
  // the filter it compiles to, which fills the advanced picker.
  async function runPreview() {
    const requestId = (previewRequestId += 1);
    const fromPreset = !advancedIsOpen() && Boolean(state.quick);
    const body = fromPreset ? { preset: state.quick } : { filter: pickerFilter() };
    // Captured now, not read again after the await: previewQuestionsOpen can
    // change while this request is in flight.
    const requestedQuestions = state.previewQuestionsOpen;

    if (requestedQuestions) {
      body.include = "questions";
    }

    try {
      const payload = await api("/api/question-bank/preview", {
        method: "POST",
        body: JSON.stringify(body)
      });

      if (requestId !== previewRequestId) {
        return; // a newer request has already started; drop this stale one
      }

      state.preview = payload;
      state.previewIncludesQuestions = requestedQuestions;
      state.previewError = null;

      if (fromPreset && !state.pickerEdited) {
        fillPickerFromFilter(payload.filter);
        refreshAdvancedPicker();
      }
    } catch (error) {
      if (requestId !== previewRequestId) {
        return;
      }

      state.preview = null;
      state.previewError = error.message;
    }

    state.previewLoading = false;
    renderPreviewPanel();
    renderQuickSummary();
    updateCreateButtonState();
  }

  function renderPreviewPanel() {
    const el = document.getElementById("previewPanel");
    if (!el) {
      return;
    }

    if (state.previewLoading && !state.preview && !state.previewError) {
      el.innerHTML = `<div class="sk-list" role="status"><span class="visually-hidden-b">Checking what matches&hellip;</span>${skeletonRows(2)}</div>`;
      return;
    }

    if (state.previewError) {
      el.innerHTML = `<p class="notice notice--critical">${escapeHtml(state.previewError)}</p>`;
      return;
    }

    if (!state.preview) {
      el.innerHTML = `<p class="muted">Pick what to test and the matching questions show up here.</p>`;
      return;
    }

    const preview = state.preview;
    const counts = obj => Object.entries(obj || {}).map(([key, count]) => `${escapeHtml(key)} ${count}`).join(", ") || "&mdash;";
    // aiRequired: some matched question is AI-scored. warning: AI is off, so
    // those answers will wait for the teacher to mark them.
    const aiFlag = preview.aiRequired;
    // state.preview.questions may still be the plain summary shape if the
    // toggle just turned on and its include: "questions" fetch has not
    // resolved yet: render the compact list only once both agree.
    const showQuestionPreview = state.previewQuestionsOpen && state.previewIncludesQuestions;

    el.innerHTML = `
      <div class="row">
        <h3>${preview.count} question${preview.count === 1 ? "" : "s"}</h3>
        <span class="muted small">${preview.totalPoints} point${preview.totalPoints === 1 ? "" : "s"}</span>
        ${aiFlag !== undefined ? `<span class="tag ${aiFlag ? "tag--accent" : ""}">${aiFlag ? "Uses AI scoring" : "No AI scoring"}</span>` : ""}
        ${qpToggleButton(preview)}
      </div>
      ${preview.count === 0 ? `<p class="notice notice--critical mt-s">No questions match. Widen the selection before you create the event.</p>` : ""}
      ${preview.warning ? `<p class="notice notice--warning mt-s">${escapeHtml(preview.warning)}</p>` : ""}
      <dl class="preview-facts">
        <dt>Levels</dt><dd>${counts(preview.byLevel)}</dd>
        <dt>Types</dt><dd>${counts(preview.byType)}</dd>
        <dt>Audiences</dt><dd>${counts(preview.byAudience)}</dd>
      </dl>
      ${showQuestionPreview
        ? renderQuestionPreview(preview.questions)
        : (state.previewQuestionsOpen
          ? `<div class="sk-list" role="status"><span class="visually-hidden-b">Loading questions&hellip;</span>${skeletonRows(3)}</div>`
          : (preview.questions && preview.questions.length
            ? `<ol class="preview-list">${preview.questions.map(q => `<li>${escapeHtml(q.title)} <span class="muted">${escapeHtml(q.level)} · ${escapeHtml(q.type)}</span></li>`).join("")}</ol>`
            : ""))
      }
    `;

    bindQpToggle(el);

    if (showQuestionPreview) {
      bindQuestionPreviewEvents(el);
    }
  }

  // The "Preview questions" toggle. It appears twice: under the quick setup
  // cards (the default path) and in the Customise panel, and both flip the
  // same state.
  function qpToggleButton(preview) {
    return preview.count
      ? `<button type="button" class="btn btn--ghost btn--sm" data-qp-toggle aria-expanded="${state.previewQuestionsOpen}">${state.previewQuestionsOpen ? "Hide questions" : "Preview questions"}</button>`
      : "";
  }

  function bindQpToggle(container) {
    const button = container.querySelector("[data-qp-toggle]");

    if (!button) {
      return;
    }

    button.addEventListener("click", () => {
      state.previewQuestionsOpen = !state.previewQuestionsOpen;

      // Toggling on needs the full teacher views, which the summary
      // request did not fetch; toggling off can redraw at once.
      if (state.previewQuestionsOpen) {
        runPreview();
      }
      renderPreviewPanel();
      renderQuickSummary();
    });
  }

  function advancedIsOpen() {
    const details = document.getElementById("advancedPicker");
    return Boolean(details && details.open);
  }

  // Whether the advanced filter should be used to build the event, rather
  // than the simple selectionMode path. A failed catalog fetch must never
  // trap the teacher behind a picker that cannot run a preview.
  function advancedActive() {
    return advancedIsOpen() && !state.catalogFailed && Boolean(state.catalog);
  }

  // Whether the quick setup cards decide the questions: presets loaded and
  // the advanced picker closed.
  function quickActive() {
    return !advancedActive() && Boolean(state.presets && state.quick);
  }

  function updateCreateButtonState() {
    const btn = document.getElementById("createEventBtn");
    if (!btn) {
      return;
    }

    const changing = state.view === "questions";
    const blocked = (changing && !advancedActive() && !quickActive() && !document.getElementById("selectionMode")) ||
      ((advancedActive() || quickActive()) && (!state.preview || state.preview.count === 0 || state.previewError));
    btn.disabled = Boolean(blocked);
  }

  // ---------- Quick setup cards ----------

  function presetById(id) {
    return (state.presets && state.presets.presets.find(preset => preset.id === id)) || null;
  }

  // The knobs for the chosen card: who it is for, which Brennan & Resnick
  // dimension to emphasise, and how long. Only the knobs the preset offers.
  function renderQuickKnobs(preset) {
    const knobs = [];

    if (preset.knobs.includes("who")) {
      const groups = [];
      preset.whoOptions.forEach(option => {
        let group = groups.find(item => item.label === option.group);
        if (!group) {
          group = { label: option.group, options: [] };
          groups.push(group);
        }
        group.options.push(option);
      });

      const optionHtml = option => `<option value="${escapeHtml(option.value)}" ${state.quick.who === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`;

      knobs.push(`
        <div class="field quick__who">
          <label for="quickWho">For</label>
          <select id="quickWho" data-quick-knob="who">
            ${groups.length > 1
              ? groups.map(group => `<optgroup label="${escapeHtml(group.label)}">${group.options.map(optionHtml).join("")}</optgroup>`).join("")
              : preset.whoOptions.map(optionHtml).join("")}
          </select>
        </div>
      `);
    }

    if (preset.knobs.includes("emphasis")) {
      knobs.push(`
        <div class="field">
          <label for="quickEmphasis">Emphasis</label>
          <select id="quickEmphasis" data-quick-knob="emphasis">
            ${(preset.emphasisOptions || state.presets.emphasis).map(item => `<option value="${escapeHtml(item.id)}" ${state.quick.emphasis === item.id ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </div>
      `);
    }

    if (preset.knobs.includes("length")) {
      knobs.push(`
        <div class="field">
          <label for="quickLength">Length</label>
          <select id="quickLength" data-quick-knob="length">
            <option value="full" ${state.quick.length === "full" ? "selected" : ""}>Full set</option>
            <option value="short" ${state.quick.length === "short" ? "selected" : ""}>Short (${state.presets.shortLength})</option>
          </select>
        </div>
      `);
    }

    return knobs.length ? `<div class="quick__knobs">${knobs.join("")}</div>` : "";
  }

  // The count on a card: live from the preview for the chosen card, the
  // default count for the others.
  function presetCount(preset) {
    const chosen = state.quick && state.quick.id === preset.id;
    const count = chosen && state.preview && !advancedIsOpen() ? state.preview.count : preset.count;
    return `${count} question${count === 1 ? "" : "s"}`;
  }

  function renderQuickSetup() {
    if (!state.presets) {
      return "";
    }

    return `
      <fieldset class="quick field--full" id="quickSetup">
        <legend class="legend">Questions</legend>
        <ul class="quick__list">
          ${state.presets.presets.map(preset => {
            const chosen = state.quick && state.quick.id === preset.id;
            return `
              <li class="preset ${chosen ? "preset--chosen" : ""}">
                <label class="preset__pick">
                  <input type="radio" name="quickPreset" value="${escapeHtml(preset.id)}" ${chosen ? "checked" : ""} />
                  <span class="preset__text">
                    <span class="preset__label">${escapeHtml(preset.label)}</span>
                    <span class="preset__desc">${escapeHtml(preset.description)}</span>
                  </span>
                  <span class="preset__count" data-preset-count="${escapeHtml(preset.id)}">${presetCount(preset)}</span>
                </label>
                ${chosen ? renderQuickKnobs(preset) : ""}
              </li>
            `;
          }).join("")}
        </ul>
        <div id="quickSummary" aria-live="polite"></div>
      </fieldset>
    `;
  }

  // One line under the cards: points, AI scoring, and the AI-off warning.
  function renderQuickSummary() {
    const el = document.getElementById("quickSummary");

    if (!el) {
      return;
    }

    document.querySelectorAll("[data-preset-count]").forEach(span => {
      const preset = presetById(span.getAttribute("data-preset-count"));
      if (preset) {
        span.textContent = presetCount(preset);
      }
    });

    if (advancedIsOpen()) {
      el.innerHTML = `<p class="muted small">Customise is open, so it decides the questions.</p>`;
      return;
    }

    if (state.previewError) {
      el.innerHTML = `<p class="notice notice--critical">${escapeHtml(state.previewError)}</p>`;
      return;
    }

    if (!state.preview) {
      el.innerHTML = `<div class="sk-list" role="status"><span class="visually-hidden-b">Checking what matches&hellip;</span>${skeletonRows(2)}</div>`;
      return;
    }

    const preview = state.preview;
    const showQuestionPreview = state.previewQuestionsOpen && state.previewIncludesQuestions;
    el.innerHTML = `
      <div class="row small">
        <span>${preview.count} question${preview.count === 1 ? "" : "s"}, ${preview.totalPoints} point${preview.totalPoints === 1 ? "" : "s"}</span>
        <span class="tag ${preview.aiRequired ? "tag--accent" : ""}">${preview.aiRequired ? "Uses AI scoring" : "No AI scoring"}</span>
        ${qpToggleButton(preview)}
      </div>
      ${preview.count === 0 ? `<p class="notice notice--critical mt-s">No questions match. Pick another setting before you create the event.</p>` : ""}
      ${preview.warning ? `<p class="notice notice--warning mt-s">${escapeHtml(preview.warning)}</p>` : ""}
      ${state.previewQuestionsOpen
        ? (showQuestionPreview ? renderQuestionPreview(preview.questions) : `<div class="sk-list" role="status"><span class="visually-hidden-b">Loading questions&hellip;</span>${skeletonRows(3)}</div>`)
        : ""}
    `;

    bindQpToggle(el);

    if (showQuestionPreview) {
      bindQuestionPreviewEvents(el);
    }
  }

  function bindQuickSetupEvents() {
    const container = document.getElementById("quickSetup");

    if (!container) {
      return;
    }

    container.querySelectorAll('input[name="quickPreset"]').forEach(input => {
      input.addEventListener("change", () => {
        const preset = presetById(input.value);
        state.quick = { ...preset.defaults };
        state.pickerEdited = false;
        state.preview = null;
        refreshQuickSetup();
        schedulePreview();
        updateCreateButtonState();
      });
    });

    container.querySelectorAll("[data-quick-knob]").forEach(select => {
      select.addEventListener("change", () => {
        state.quick = { ...state.quick, [select.getAttribute("data-quick-knob")]: select.value };
        state.pickerEdited = false;
        schedulePreview();
        renderQuickSummary();
        updateCreateButtonState();
      });
    });
  }

  function refreshQuickSetup() {
    const container = document.getElementById("quickSetup");

    if (!container) {
      return;
    }

    container.outerHTML = renderQuickSetup();
    bindQuickSetupEvents();
    renderQuickSummary();
  }

  // ---------- Event settings ----------

  function renderSettingRadios(name, legend, labels, hints) {
    return `
      <fieldset class="setting field--full" id="${name}Setting">
        <legend class="legend">${escapeHtml(legend)}</legend>
        <div class="setting__options">
          ${Object.keys(labels).map(value => `
            <label class="check">
              <input type="radio" name="${name}" value="${value}" ${state.settings[name] === value ? "checked" : ""} />
              ${escapeHtml(labels[value])}
            </label>
          `).join("")}
        </div>
        ${hints}
      </fieldset>
    `;
  }

  function feedbackWarningHtml() {
    const warning = FEEDBACK_WARNINGS[state.settings.feedbackMode];
    return warning ? `<p class="notice notice--warning" id="feedbackWarning">${escapeHtml(warning)}</p>` : `<span id="feedbackWarning" hidden></span>`;
  }

  function navigationHintHtml() {
    return state.settings.navigationMode === "linear"
      ? `<p class="picker__hint" id="navigationHint">Students must answer or skip each question to move on, and cannot go back to it.</p>`
      : `<span id="navigationHint" hidden></span>`;
  }

  function renderSettings() {
    return `
      ${renderSettingRadios("feedbackMode", "Students see which answers were right", {
        each: "After each question",
        end: "At the end of the test",
        release: "When I release them"
      }, feedbackWarningHtml())}
      ${renderSettingRadios("navigationMode", "Moving between questions", {
        free: "Free: back, next and skip",
        linear: "In order: forward only"
      }, navigationHintHtml())}
    `;
  }

  function bindSettingsEvents() {
    document.querySelectorAll('input[name="feedbackMode"], input[name="navigationMode"]').forEach(input => {
      input.addEventListener("change", () => {
        state.settings[input.name] = input.value;
        document.getElementById("feedbackWarning").outerHTML = feedbackWarningHtml();
        document.getElementById("navigationHint").outerHTML = navigationHintHtml();
      });
    });
  }

  // ---------- Advanced picker: markup ----------

  function renderLevelCheckboxes() {
    const levels = audienceLevels(state.picker.audience);
    return levels.map(levelId => {
      const level = state.catalog.levels.find(item => item.id === levelId) || { id: levelId, label: levelId };
      const checked = state.picker.levels.includes(levelId);
      return `
        <label class="check">
          <input type="checkbox" data-picker-level="${escapeHtml(levelId)}" ${checked ? "checked" : ""} />
          ${escapeHtml(level.label || level.id)}
        </label>
      `;
    }).join("");
  }

  function outcomeMatchesAudienceAndLevel(outcome) {
    const audienceOk = !outcome.audiences.length || outcome.audiences.includes(state.picker.audience);
    const levelOk = !state.picker.levels.length || outcome.levels.some(level => state.picker.levels.includes(level));
    return audienceOk && levelOk;
  }

  function renderOutcomeGroups() {
    const nodesById = new Map((state.ontology ? state.ontology.nodes : []).map(node => [node.id, node]));
    const visible = (state.outcomes || []).filter(outcomeMatchesAudienceAndLevel);

    if (!visible.length) {
      return `<p class="muted small">No learning outcomes match this audience and level yet.</p>`;
    }

    const groups = new Map();

    visible.forEach(outcome => {
      const groupId = outcome.nodes[0] || "ungrouped";
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId).push(outcome);
    });

    return `<div class="outcome-groups">${Array.from(groups.entries()).map(([nodeId, outcomes]) => {
      const node = nodesById.get(nodeId);
      const heading = node ? node.label : "Other";

      return `
        <fieldset class="outcome-group">
          <legend>${escapeHtml(heading)}</legend>
          ${outcomes.map(outcome => {
            const checked = state.picker.outcomes.includes(outcome.id);
            const inputId = `outcome-${outcome.id}`;
            return `
              <label class="outcome-option" for="${inputId}">
                <input type="checkbox" id="${inputId}" data-picker-outcome="${escapeHtml(outcome.id)}" ${checked ? "checked" : ""} />
                <span>${escapeHtml(outcome.statement)} <span class="muted">(${outcome.questionCount})</span></span>
              </label>
            `;
          }).join("")}
        </fieldset>
      `;
    }).join("")}</div>`;
  }

  // A keyboard-operable expandable tree using native <details>/<summary>, one
  // per ontology branch, with a checkbox per node. Checking a node includes
  // everything beneath it (selection.js expands nodes server-side), so a
  // child checkbox is left independently selectable rather than implied, and
  // the displayed count rolls up every descendant to match what checking the
  // node would actually select (the API's own questionCount is a direct-tag
  // count only, which would show 0 on every top-level node).
  function renderOntologyTree() {
    if (!state.ontology) {
      return "";
    }

    const byParent = new Map();
    state.ontology.nodes.forEach(node => {
      const key = node.parent || "__root__";
      if (!byParent.has(key)) {
        byParent.set(key, []);
      }
      byParent.get(key).push(node);
    });

    const rollupCount = new Map();
    function computeRollup(node) {
      const children = byParent.get(node.id) || [];
      const total = node.questionCount + children.reduce((sum, child) => sum + computeRollup(child), 0);
      rollupCount.set(node.id, total);
      return total;
    }
    (byParent.get("__root__") || []).forEach(computeRollup);

    function renderNode(node) {
      const children = byParent.get(node.id) || [];
      const checked = state.picker.nodes.includes(node.id);
      const inputId = `node-${node.id}`;
      const count = rollupCount.get(node.id) || 0;
      const labelRow = `
        <label class="tree-row" for="${inputId}">
          <input type="checkbox" id="${inputId}" data-picker-node="${escapeHtml(node.id)}" ${checked ? "checked" : ""} />
          <span>${escapeHtml(node.label)}</span>
          <span class="tree-count">${count} question${count === 1 ? "" : "s"}</span>
        </label>
      `;

      if (!children.length) {
        return `<div class="tree-leaf">${labelRow}</div>`;
      }

      return `
        <details class="tree-branch">
          <summary>${labelRow}</summary>
          <div class="tree-children">${children.map(renderNode).join("")}</div>
        </details>
      `;
    }

    const roots = byParent.get("__root__") || [];
    return roots.map(renderNode).join("");
  }

  function renderTypeCheckboxes() {
    if (!state.catalog) {
      return "";
    }

    return state.catalog.questionTypes.map(type => {
      const active = type.status === "active";
      const checked = state.picker.types.includes(type.type);
      const inputId = `type-${type.type}`;

      return `
        <label class="check ${active ? "" : "check--disabled"}" for="${inputId}">
          <input type="checkbox" id="${inputId}" data-picker-type="${escapeHtml(type.type)}" ${checked ? "checked" : ""} ${active ? "" : "disabled"} />
          ${escapeHtml(type.label)}${active ? "" : ` <span class="muted small">(coming later)</span>`}
        </label>
      `;
    }).join("");
  }

  function renderAdvancedPicker() {
    if (state.catalogFailed) {
      return `<p class="muted picker">The question picker could not load. The question set above still works.</p>`;
    }

    if (!state.catalog || !state.ontology || !state.outcomes) {
      return `<p class="muted picker">Loading the question picker&hellip;</p>`;
    }

    return `
      <div class="picker">
        <div class="picker__filters">
          <p class="notice">While this is open, it replaces the ${state.presets ? "quick setup" : "question set"} above.</p>

          <div class="picker__row">
            <fieldset>
              <legend class="legend">Audience</legend>
              <div class="row">
                ${state.catalog.audiences.map(audience => `
                  <label class="check">
                    <input type="radio" name="pickerAudience" value="${escapeHtml(audience.id)}" ${state.picker.audience === audience.id ? "checked" : ""} />
                    ${escapeHtml(audience.label)}
                  </label>
                `).join("")}
              </div>
            </fieldset>

            <fieldset>
              <legend class="legend">Levels</legend>
              <div class="row" id="pickerLevels">${renderLevelCheckboxes()}</div>
            </fieldset>

            <fieldset>
              <legend class="legend">Difficulty, 1 to 5</legend>
              <div class="picker__difficulty">
                <label class="visually-hidden" for="difficultyMin">Lowest difficulty</label>
                <input id="difficultyMin" type="number" min="1" max="5" placeholder="From" value="${escapeHtml(state.picker.difficultyMin)}" />
                <label class="visually-hidden" for="difficultyMax">Highest difficulty</label>
                <input id="difficultyMax" type="number" min="1" max="5" placeholder="To" value="${escapeHtml(state.picker.difficultyMax)}" />
              </div>
            </fieldset>

            <fieldset>
              <legend class="legend">Most questions</legend>
              <div class="picker__difficulty">
                <label class="visually-hidden" for="pickerLimit">Most questions</label>
                <input id="pickerLimit" type="number" min="1" max="100" placeholder="All" value="${escapeHtml(state.picker.limit)}" />
              </div>
            </fieldset>
          </div>
          <p class="picker__hint">No levels ticked means every level this audience offers. A most-questions cap keeps a spread across levels and outcomes.</p>

          <fieldset>
            <legend class="legend">Question types</legend>
            <div class="row" id="pickerTypes">${renderTypeCheckboxes()}</div>
            <p class="picker__hint">No types ticked means every type except AI-scored ones. Tick those to include them.</p>
          </fieldset>

          <fieldset>
            <legend class="legend">Learning outcomes</legend>
            <div id="pickerOutcomes">${renderOutcomeGroups()}</div>
          </fieldset>

          <fieldset>
            <legend class="legend">CT capabilities</legend>
            <div class="tree" id="pickerTree">${renderOntologyTree()}</div>
          </fieldset>
        </div>

        <aside class="picker__preview" id="previewPanel" aria-live="polite" aria-label="Preview"></aside>
      </div>
    `;
  }

  // Re-renders the picker's body after a preset fills it. Expanded tree
  // branches close; the picker is usually collapsed when this runs.
  function refreshAdvancedPicker() {
    const body = document.getElementById("advancedPickerBody");

    if (!body) {
      return;
    }

    body.innerHTML = renderAdvancedPicker();
    bindAdvancedPickerEvents();
  }

  function bindAdvancedPickerEvents() {
    const container = document.getElementById("advancedPickerBody");
    if (!container || state.catalogFailed || !state.catalog) {
      return;
    }

    function onPickerChange() {
      state.pickerEdited = true;
      schedulePreview();
      renderPreviewPanel();
      updateCreateButtonState();
    }

    function bindLevelInputs() {
      document.querySelectorAll("[data-picker-level]").forEach(input => {
        input.addEventListener("change", () => {
          const levelId = input.getAttribute("data-picker-level");
          state.picker.levels = input.checked
            ? state.picker.levels.concat(levelId)
            : state.picker.levels.filter(id => id !== levelId);
          refreshOutcomesPanel();
          onPickerChange();
        });
      });
    }

    function bindOutcomeInputs() {
      document.querySelectorAll("[data-picker-outcome]").forEach(input => {
        input.addEventListener("change", () => {
          const outcomeId = input.getAttribute("data-picker-outcome");
          state.picker.outcomes = input.checked
            ? state.picker.outcomes.concat(outcomeId)
            : state.picker.outcomes.filter(id => id !== outcomeId);
          onPickerChange();
        });
      });
    }

    // Levels depend only on the chosen audience; outcomes depend on both. The
    // ontology tree and type list depend on neither, so leaving them alone on
    // an audience/level change keeps any expanded tree branches open.
    function refreshLevelsPanel() {
      const el = document.getElementById("pickerLevels");
      if (!el) {
        return;
      }
      el.innerHTML = renderLevelCheckboxes();
      bindLevelInputs();
    }

    function refreshOutcomesPanel() {
      const el = document.getElementById("pickerOutcomes");
      if (!el) {
        return;
      }
      el.innerHTML = renderOutcomeGroups();
      bindOutcomeInputs();
    }

    container.querySelectorAll('input[name="pickerAudience"]').forEach(input => {
      input.addEventListener("change", () => {
        state.picker.audience = input.value;
        state.picker.levels = [];
        refreshLevelsPanel();
        refreshOutcomesPanel();
        onPickerChange();
      });
    });

    bindLevelInputs();
    bindOutcomeInputs();

    container.querySelectorAll("[data-picker-node]").forEach(input => {
      input.addEventListener("change", () => {
        const nodeId = input.getAttribute("data-picker-node");
        state.picker.nodes = input.checked
          ? state.picker.nodes.concat(nodeId)
          : state.picker.nodes.filter(id => id !== nodeId);
        onPickerChange();
      });
    });

    container.querySelectorAll("[data-picker-type]").forEach(input => {
      input.addEventListener("change", () => {
        const typeId = input.getAttribute("data-picker-type");
        state.picker.types = input.checked
          ? state.picker.types.concat(typeId)
          : state.picker.types.filter(id => id !== typeId);
        onPickerChange();
      });
    });

    const min = document.getElementById("difficultyMin");
    const max = document.getElementById("difficultyMax");

    if (min) {
      min.addEventListener("input", () => {
        state.picker.difficultyMin = min.value;
        onPickerChange();
      });
    }

    if (max) {
      max.addEventListener("input", () => {
        state.picker.difficultyMax = max.value;
        onPickerChange();
      });
    }

    const limit = document.getElementById("pickerLimit");

    if (limit) {
      limit.addEventListener("input", () => {
        state.picker.limit = limit.value;
        onPickerChange();
      });
    }

    renderPreviewPanel();
  }

  // Opening or closing Customise changes what decides the questions, so the
  // preview reruns for whichever now applies.
  function bindAdvancedToggle() {
    const details = document.getElementById("advancedPicker");

    if (!details) {
      return;
    }

    details.addEventListener("toggle", () => {
      schedulePreview();
      renderPreviewPanel();
      renderQuickSummary();
      updateCreateButtonState();
    });
  }

  // ---------- Per-outcome results ----------

  function sortRows(rows, key, dir) {
    const sorted = rows.slice().sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (typeof va === "string") {
        return va.localeCompare(vb);
      }
      return (va || 0) - (vb || 0);
    });
    return dir === "desc" ? sorted.reverse() : sorted;
  }

  // A sortable column header. Both tables share one sort, as before.
  function outcomesSummaryHeader(label, key) {
    const active = state.outcomesSort.key === key;
    const arrow = active ? (state.outcomesSort.dir === "asc" ? " &uarr;" : " &darr;") : "";
    const sort = active ? (state.outcomesSort.dir === "asc" ? "ascending" : "descending") : "none";
    return `<th scope="col" aria-sort="${sort}"><button type="button" class="sort-btn" data-sort-key="${key}">${escapeHtml(label)}${arrow}</button></th>`;
  }

  function renderOutcomeRow(row, labelText, indent) {
    const label = `<td class="${indent ? "indent" : ""}">${escapeHtml(labelText)}`;

    if (!row.submittedAttempts) {
      return `
        <tr>
          ${label}</td>
          <td colspan="3" class="muted">No submissions yet</td>
        </tr>
      `;
    }

    const lateNote = row.lateAttempts ? ` <span class="tag status status--warning">${row.lateAttempts} late</span>` : "";
    // AI-scored answers still waiting for a mark are left out of the average.
    const unmarkedNote = row.unmarkedAnswers ? ` <span class="tag status status--pending">${row.unmarkedAnswers} not marked yet</span>` : "";
    return `
      <tr>
        ${label}${lateNote}${unmarkedNote}</td>
        <td>${row.submittedAttempts}</td>
        ${row.meanPercentage === null
          ? `<td class="muted">Not marked</td>`
          : `<td class="${row.meanPercentage < 50 ? "tone-critical" : "tone-positive"}">${row.meanPercentage}%</td>`}
        <td class="${row.belowHalfCount ? "tone-critical" : "muted"}">${row.belowHalfCount}</td>
      </tr>
    `;
  }

  function outcomesTable(caption, firstColumn, rows, labelFor) {
    return `
      <div class="table-wrap">
        <table class="data-table">
          <caption>${escapeHtml(caption)}</caption>
          <thead>
            <tr>
              <th scope="col">${escapeHtml(firstColumn)}</th>
              ${outcomesSummaryHeader("Students", "submittedAttempts")}
              ${outcomesSummaryHeader("Average", "meanPercentage")}
              ${outcomesSummaryHeader("Below 50%", "belowHalfCount")}
            </tr>
          </thead>
          <tbody>${rows.map(labelFor).join("")}</tbody>
        </table>
      </div>
    `;
  }

  // The sortable tables, now the secondary view under each chart.
  function outcomesTableHtml() {
    const rows = sortRows(state.outcomesSummary.outcomes, state.outcomesSort.key, state.outcomesSort.dir);
    return rows.length
      ? outcomesTable("Learning outcomes", "Outcome", rows, row => renderOutcomeRow(row, row.statement, false))
      : `<p class="muted">No learning outcome has submissions yet.</p>`;
  }

  function capabilitiesTableHtml() {
    const rows = sortRows(state.outcomesSummary.ontologyNodes, state.outcomesSort.key, state.outcomesSort.dir);
    return rows.length
      ? outcomesTable("CT capabilities", "Capability", rows, row => renderOutcomeRow(row, row.label, !row.topLevel))
      : `<p class="muted">No CT capability has submissions yet.</p>`;
  }

  // ---------- Cohort results: tiles, charts and collapsible sections ----------

  const Charts = window.CTQuestCharts;
  const OPEN_SECTIONS_KEY = "ct-quest-open-sections";
  // Only the overview starts open; the rest wait to be asked for.
  const SECTION_DEFAULTS = { overview: true };

  function loadOpenSections() {
    try {
      const saved = JSON.parse(localStorage.getItem("ct-quest-open-sections") || "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch (_error) {
      return {};
    }
  }

  function saveOpenSections() {
    try {
      localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(state.openSections));
    } catch (_error) {
      // Storage can be full or blocked; the state still holds for this visit.
    }
  }

  function sectionOpen(key) {
    return Object.prototype.hasOwnProperty.call(state.openSections, key)
      ? Boolean(state.openSections[key])
      : Boolean(SECTION_DEFAULTS[key]);
  }

  // A top-level results section: a <details> whose open state lives in
  // state.openSections under key.
  function resultsSection(key, title, meta, body) {
    return `
      <details class="results-section" data-section="${key}" id="section-${key}" ${sectionOpen(key) ? "open" : ""}>
        <summary><span class="results-section__title">${escapeHtml(title)}</span>${meta ? `<span class="muted small">${meta}</span>` : ""}</summary>
        <div class="results-section__body">${body}</div>
      </details>
    `;
  }

  // A nested disclosure (a table under a chart, the question preview) whose
  // open state is kept the same way.
  function subSection(key, title, body, id) {
    return `
      <details class="history sub-section" data-section="${key}" ${id ? `id="${id}"` : ""} ${sectionOpen(key) ? "open" : ""}>
        <summary>${escapeHtml(title)}</summary>
        ${body}
      </details>
    `;
  }

  function chartsOr(fallback, build) {
    return Charts ? build() : `<p class="muted small">${escapeHtml(fallback)}</p>`;
  }

  function liveAttemptsOf(results) {
    return results.attempts.filter(attempt => !attempt.reset_at);
  }

  function countAnswers(attempts, status) {
    return attempts.reduce((sum, attempt) => sum + attempt.answers.filter(answer => answer.scoreStatus === status).length, 0);
  }

  function plural(n, word, many) {
    return `${n} ${n === 1 ? word : (many || `${word}s`)}`;
  }

  function resultTiles(canManage) {
    const live = liveAttemptsOf(state.results);
    const submitted = live.filter(attempt => attempt.status === "submitted");
    const late = submitted.filter(attempt => attempt.late).length;
    const overall = state.outcomesSummary && state.outcomesSummary.overall;
    const mean = overall && overall.meanPercentage !== null ? `${overall.meanPercentage}%` : "–";
    const below = overall ? overall.belowHalfCount : 0;
    const needs = countAnswers(live, "needs-review");
    const pending = countAnswers(live, "pending");
    const tile = (label, value, note, tone) => `
      <li class="stat-tile">
        <span class="stat-tile__label">${label}</span>
        <span class="stat-tile__value ${tone ? `tone-${tone}` : ""}">${value}</span>
        ${note ? `<span class="stat-tile__note muted">${note}</span>` : ""}
      </li>`;

    return `
      <ul class="stat-tiles" aria-label="Summary">
        ${tile("Submitted", submitted.length, late ? `${late} late` : "")}
        ${tile("In progress", live.length - submitted.length, "")}
        ${tile("Mean score", mean, overall && overall.unmarkedAnswers ? `${plural(overall.unmarkedAnswers, "answer")} not marked yet left out` : "")}
        ${tile("Below 50%", below, "", below ? "critical" : "")}
        ${tile("Needs marking", needs, `${pending ? `${pending} being marked by AI` : ""}${needs ? `${pending ? " · " : ""}<button type="button" class="link-btn" data-open-section="students">${canManage ? "Mark in Students" : "See Students"}</button>` : ""}`, needs ? "warning" : "")}
      </ul>
    `;
  }

  function overviewSection() {
    const summary = state.outcomesSummary;
    const scores = summary && summary.perAttempt ? summary.perAttempt.map(row => row.percentage) : [];
    const marked = scores.filter(value => value !== null).length;
    const body = !summary
      ? `<p class="muted small">Could not load the summary.</p>`
      : chartsOr("Charts could not load.", () => Charts.histogram(scores, 10, {
        title: "How the class scored",
        desc: "Each column counts the students whose score falls in that range. Answers not marked yet are left out."
      }));

    return resultsSection("overview", "Overview", marked ? `Score spread, ${plural(marked, "student")}` : "Score spread", body);
  }

  function questionsSection() {
    const summary = state.outcomesSummary;
    const questions = state.eventQuestions || [];
    const numberOf = new Map(questions.map((question, i) => [question.id, i + 1]));
    const rows = summary && summary.questions
      ? summary.questions.slice().sort((a, b) => (a.percentage === null) - (b.percentage === null) || (a.percentage || 0) - (b.percentage || 0))
        .map(row => {
          const notes = [];
          if (row.maxPoints <= 0) {
            notes.push("worth no points");
          } else if (row.markedAttempts) {
            notes.push(`${row.fullMarks}/${row.markedAttempts} full marks`);
          }
          if (row.skipped) {
            notes.push(`${row.skipped} skipped`);
          }
          if (row.unmarkedAnswers) {
            notes.push(`${row.unmarkedAnswers} not marked yet`);
          }
          return {
            label: `Q${numberOf.get(row.id) || "?"}. ${row.title || row.id}`,
            value: row.percentage,
            note: notes.join(" · ")
          };
        })
      : [];

    const chart = !summary
      ? `<p class="muted small">Could not load the summary.</p>`
      : chartsOr("Charts could not load.", () => Charts.barChart(rows, {
        threshold: 50,
        title: "Average score on each question, hardest first",
        nullText: "No marks yet",
        emptyText: "No marked answers yet."
      }));

    const preview = subSection(
      "questionPreview",
      `Question preview${state.eventQuestions ? ` (${state.eventQuestions.length})` : ""}`,
      state.eventQuestions ? renderQuestionPreview(state.eventQuestions) : `<p class="muted small">Could not load the questions.</p>`,
      "eventQuestionsSection"
    );

    return resultsSection(
      "questions",
      "Questions",
      `${plural(questions.length, "question")} · hardest first`,
      `<p class="muted small">Average share of the points, over submitted attempts.</p>${chart}${renderEventComposition(state.eventQuestions)}${preview}`
    );
  }

  // Depth of a CT node under its top-level node, from its dotted id.
  function nodeDepth(node) {
    return node.topLevel ? 0 : Math.min(2, node.id.split(".").length - 1);
  }

  // Each top-level node followed by the reported nodes beneath it.
  function capabilityOrder(nodes) {
    const tops = nodes.filter(node => node.topLevel);
    const ordered = [];

    tops.forEach(top => {
      ordered.push(top);
      nodes.filter(node => !node.topLevel && node.id.startsWith(`${top.id}.`))
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach(node => ordered.push(node));
    });

    nodes.filter(node => !ordered.includes(node)).forEach(node => ordered.push(node));
    return ordered;
  }

  function groupNote(row) {
    const notes = [];
    if (row.unmarkedAnswers) {
      notes.push(`${row.unmarkedAnswers} not marked yet`);
    }
    if (row.lateAttempts) {
      notes.push(`${row.lateAttempts} late`);
    }
    return notes.join(" · ");
  }

  function outcomesSection() {
    const summary = state.outcomesSummary;

    if (!summary) {
      return resultsSection("outcomes", "Learning outcomes", "", `<p class="muted small">Could not load the summary.</p>`);
    }

    const rows = summary.outcomes.slice()
      .sort((a, b) => (a.meanPercentage === null) - (b.meanPercentage === null) || (a.meanPercentage || 0) - (b.meanPercentage || 0))
      .map(row => ({ label: row.statement, value: row.meanPercentage, note: groupNote(row) }));
    const chart = chartsOr("Charts could not load.", () => Charts.barChart(rows, {
      threshold: 50,
      title: "Class average for each learning outcome, weakest first",
      nullText: "No marks yet",
      emptyText: "No learning outcome has submissions yet."
    }));

    return resultsSection(
      "outcomes",
      "Learning outcomes",
      `${plural(summary.outcomes.length, "outcome")} · weakest first`,
      `${chart}${subSection("outcomesTable", "Show table", outcomesTableHtml())}`
    );
  }

  function capabilitiesSection() {
    const summary = state.outcomesSummary;

    if (!summary) {
      return resultsSection("capabilities", "CT capabilities", "", `<p class="muted small">Could not load the summary.</p>`);
    }

    const rows = capabilityOrder(summary.ontologyNodes)
      .map(row => ({ label: row.label, value: row.meanPercentage, note: groupNote(row), indent: nodeDepth(row) }));
    const chart = chartsOr("Charts could not load.", () => Charts.barChart(rows, {
      threshold: 50,
      title: "Class average for each CT capability, with the capabilities beneath each indented",
      nullText: "No marks yet",
      emptyText: "No CT capability has submissions yet."
    }));

    return resultsSection(
      "capabilities",
      "CT capabilities",
      `${plural(summary.ontologyNodes.length, "capability", "capabilities")}`,
      `${chart}${subSection("capabilitiesTable", "Show table", capabilitiesTableHtml())}`
    );
  }

  // A small word beside an attempt row when its answers wait for a mark.
  function markingBadges(attempt) {
    const needs = attempt.answers.filter(answer => answer.scoreStatus === "needs-review").length;
    const pending = attempt.answers.filter(answer => answer.scoreStatus === "pending").length;
    return `${needs ? `<span class="tag status status--warning">${needs} needs marking</span>` : ""}${pending ? `<span class="tag status status--pending">${pending} being marked</span>` : ""}`;
  }

  function sectionControls() {
    return `
      <div class="section-controls">
        <button type="button" class="btn btn--ghost btn--sm" data-sections-expand>Expand all</button>
        <button type="button" class="btn btn--ghost btn--sm" data-sections-collapse>Collapse all</button>
      </div>
    `;
  }

  function bindSections() {
    screen.querySelectorAll("details[data-section]").forEach(details => {
      details.addEventListener("toggle", () => {
        const key = details.getAttribute("data-section");
        if (sectionOpen(key) !== details.open) {
          state.openSections = { ...state.openSections, [key]: details.open };
          saveOpenSections();
        }
      });
    });

    const setAll = open => screen.querySelectorAll("details.results-section").forEach(details => { details.open = open; });
    const expand = screen.querySelector("[data-sections-expand]");
    const collapse = screen.querySelector("[data-sections-collapse]");

    if (expand) {
      expand.addEventListener("click", () => setAll(true));
    }

    if (collapse) {
      collapse.addEventListener("click", () => setAll(false));
    }

    screen.querySelectorAll("[data-open-section]").forEach(button => {
      button.addEventListener("click", () => {
        const details = document.getElementById(`section-${button.getAttribute("data-open-section")}`);
        if (details) {
          details.open = true;
          details.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      });
    });
  }

  // ---------- Per-student view (one attempt, in a dialog) ----------

  // The renderers' describeResponse gives a student's answer in words. They
  // load with the question bank's types; until then (or for a type with no
  // renderer) a plain fallback is shown.
  let typesLoaded = false;

  function ensureTypesForDialog() {
    if (typesLoaded) {
      return;
    }

    loadBankTypes().then(() => {
      typesLoaded = true;
      if (state.openAttemptId !== null && state.view === "event") {
        renderDashboard();
      }
    }).catch(() => {});
  }

  function studentAnswerText(answer) {
    if (!answer || answer.response === null || answer.response === undefined) {
      return "No answer";
    }

    try {
      const text = window.CTQuestTypes.get(answer.questionType).describeResponse(answer.response, { escapeHtml });
      return String(text).replace(/^\n/, "");
    } catch (_error) {
      const response = answer.response;
      return typeof response === "object" && typeof response.text === "string" ? response.text : JSON.stringify(response);
    }
  }

  // One answer's state, with the word that goes beside its colour.
  function answerState(answer, question) {
    if (answer && answer.scoreStatus === "pending") {
      return { key: "unmarked", tone: "pending", word: "Being marked", short: "Marking" };
    }

    if (answer && answer.scoreStatus === "needs-review") {
      return { key: "unmarked", tone: "warning", word: "Needs marking", short: "To mark" };
    }

    if (!answer || answer.response === null || answer.response === undefined) {
      return { key: "skipped", tone: "neutral", word: "Skipped", short: "Skipped" };
    }

    const max = answer.maxPoints ?? (question ? question.points : 0);
    const earned = answer.earnedPoints || 0;

    if (max > 0 && earned >= max) {
      return { key: "correct", tone: "positive", word: "Correct", short: "Correct" };
    }

    if (earned > 0) {
      return { key: "partial", tone: "warning", word: "Part marks", short: "Part" };
    }

    return { key: "wrong", tone: "critical", word: "Incorrect", short: "Wrong" };
  }

  // The questions in snapshot order, each with this attempt's answer (or
  // none). Falls back to the answers alone if the snapshot did not load.
  function attemptItems(attempt) {
    const byId = new Map(attempt.answers.map(answer => [answer.questionId, answer]));

    if (state.eventQuestions && state.eventQuestions.length) {
      return state.eventQuestions.map((question, i) => ({ number: i + 1, question, answer: byId.get(question.id) || null }));
    }

    return attempt.answers.map((answer, i) => ({ number: i + 1, question: null, answer }));
  }

  function answerKeyHtml(question) {
    if (!question) {
      return "";
    }

    const body = `${qpTypeBody(question)}${question.type === "open-response-ai" && question.rubric ? qpRubricTable(question.rubric) : ""}`;
    return body ? `<div class="qp-teacher"><p class="qp-teacher__label"><span class="tag">Answer key, teacher only</span></p>${body}</div>` : "";
  }

  function answerRow(attempt, item, canManage) {
    const { number, question, answer } = item;
    const id = question ? question.id : answer.questionId;
    const status = answerState(answer, question);
    const max = answer ? answer.maxPoints : question.points;
    const open = state.openAnswerRows.has(id) || (status.key === "unmarked" && status.tone === "warning" && canManage);
    const text = studentAnswerText(answer);
    const review = answer && answer.questionType === "open-response-ai" ? aiAnswerReview(attempt, answer, canManage) : "";

    return `
      <li>
        <details class="qp-row answer-row" data-answer-row="${escapeHtml(id)}" id="answer-${escapeHtml(attempt.id)}-${escapeHtml(id)}" ${open ? "open" : ""}>
          <summary>
            <span class="qp-row__num">${number}.</span>
            <span class="qp-row__title">${escapeHtml(question ? question.title : id)}</span>
            <span class="tag status status--${status.tone}">${status.word}</span>
            <span class="muted small mono">${answer && status.key !== "unmarked" ? `${answer.earnedPoints ?? 0}/${max}` : `&ndash;/${max}`}</span>
          </summary>
          <div class="qp-row__body">
            ${question ? `<p class="prompt-text">${escapeHtml(question.prompt)}</p>` : ""}
            ${review || `<p class="answer-label">Student's answer</p><pre class="codebox answer-text">${escapeHtml(text)}</pre>`}
            ${answerKeyHtml(question)}
          </div>
        </details>
      </li>
    `;
  }

  function comparisonCharts(attemptRow) {
    const summary = state.outcomesSummary;

    if (!summary || !attemptRow || !Charts) {
      return "";
    }

    const mine = list => new Map((list || []).map(row => [row.id, row.percentage]));
    const outcomeMine = mine(attemptRow.outcomes);
    const nodeMine = mine(attemptRow.nodes);
    const opts = { threshold: 50, valueLabel: "This student", compareLabel: "Class average", nullText: "Not marked yet" };
    const outcomes = Charts.barChart(summary.outcomes.map(row => ({
      label: row.statement, value: outcomeMine.has(row.id) ? outcomeMine.get(row.id) : null, compare: row.meanPercentage
    })), { ...opts, title: "This student's score on each learning outcome, beside the class average", emptyText: "No learning outcomes in this test." });
    const nodes = Charts.barChart(capabilityOrder(summary.ontologyNodes).map(row => ({
      label: row.label, value: nodeMine.has(row.id) ? nodeMine.get(row.id) : null, compare: row.meanPercentage, indent: nodeDepth(row)
    })), { ...opts, title: "This student's score on each CT capability, beside the class average", emptyText: "No CT capabilities in this test." });

    return `
      <h3 class="student-dialog__h">Learning outcomes</h3>
      ${outcomes}
      <h3 class="student-dialog__h">CT capabilities</h3>
      ${nodes}
    `;
  }

  function renderStudentDialog(canManage) {
    if (state.openAttemptId === null || !state.results) {
      return "";
    }

    const attempt = state.results.attempts.find(row => row.id === state.openAttemptId);

    if (!attempt) {
      return "";
    }

    const summary = state.outcomesSummary;
    const attemptRow = summary && summary.perAttempt ? summary.perAttempt.find(row => row.attemptId === attempt.id) : null;
    const overall = summary && summary.overall;
    const items = attemptItems(attempt);
    const counts = items.reduce((acc, item) => {
      const key = answerState(item.answer, item.question).key;
      return { ...acc, [key]: (acc[key] || 0) + 1 };
    }, {});
    const countText = [["correct", "correct"], ["partial", "part marks"], ["wrong", "incorrect"], ["unmarked", "not marked yet"], ["skipped", "skipped"]]
      .filter(([key]) => counts[key]).map(([key, word]) => `${counts[key]} ${word}`).join(", ");

    const status = attempt.reset_at
      ? `<p class="notice">This attempt was reset. It is kept as history and left out of the class figures.</p>`
      : attempt.status !== "submitted"
        ? `<p class="notice">Not submitted yet. These are the answers so far, and none of them count in the class figures.</p>`
        : "";

    const score = attemptRow && Charts
      ? Charts.barChart([{
        label: "Score",
        value: attemptRow.percentage,
        compare: overall ? overall.meanPercentage : null,
        note: attempt.max_score === null ? "" : `${attempt.score ?? 0}/${attempt.max_score} points`
      }], { threshold: 50, valueLabel: "This student", compareLabel: "Class average", nullText: "Not marked yet", title: "This student's score beside the class average", wrapAt: 40 })
      : "";

    const strip = items.map(item => {
      const state_ = answerState(item.answer, item.question);
      const id = item.question ? item.question.id : item.answer.questionId;
      const title = `${item.number}. ${item.question ? item.question.title : id}: ${state_.word}`;
      return `<li><button type="button" class="q-cell q-cell--${state_.key}" data-jump-answer="${escapeHtml(id)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><span class="q-cell__num">${item.number}</span><span class="q-cell__word">${state_.short}</span></button></li>`;
    }).join("");

    return `
      <dialog class="student-dialog" id="studentDialog" aria-labelledby="studentDialogTitle">
        <div class="student-dialog__head">
          <div class="student-dialog__who">
            <h2 id="studentDialogTitle">${escapeHtml(attempt.student_name)}</h2>
            <span class="muted small">${escapeHtml(attempt.student_group)}</span>
            ${attempt.late ? `<span class="tag status status--warning">Late</span>` : ""}
            ${markingBadges(attempt)}
          </div>
          <button type="button" class="btn btn--secondary btn--sm" data-close-student>Close</button>
        </div>
        <div class="student-dialog__body">
          ${status}
          ${score}
          <h3 class="student-dialog__h">Question by question</h3>
          ${countText ? `<p class="muted small">${escapeHtml(countText)}. Choose a question to see the answer.</p>` : ""}
          <ol class="q-strip" aria-label="Each question's result">${strip}</ol>
          ${comparisonCharts(attemptRow)}
          <h3 class="student-dialog__h">Answers</h3>
          <ol class="qp-list answer-rows">${items.map(item => answerRow(attempt, item, canManage)).join("")}</ol>
        </div>
      </dialog>
    `;
  }

  // Opens the dialog rendered into the page, keeping its scroll position
  // across a re-render. prevScroll: the old dialog's scrollTop, if any.
  function bindStudentDialog(prevScroll) {
    screen.querySelectorAll("[data-view-attempt]").forEach(button => {
      button.addEventListener("click", () => {
        const attemptId = Number(button.getAttribute("data-view-attempt"));
        if (state.openAttemptId !== attemptId) {
          state.openAnswerRows = new Set();
        }
        state.openAttemptId = attemptId;
        ensureTypesForDialog();
        renderDashboard();
      });
    });

    const dialog = document.getElementById("studentDialog");

    if (!dialog) {
      return;
    }

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    if (prevScroll) {
      dialog.scrollTop = prevScroll;
    }

    ensureTypesForDialog();

    const close = () => {
      if (dialog.open) {
        dialog.close();
      }
    };

    dialog.addEventListener("close", () => {
      // A re-render removes the old dialog; only a real close clears state.
      if (!dialog.isConnected) {
        return;
      }
      const reopen = state.openAttemptId;
      state.openAttemptId = null;
      state.openAnswerRows = new Set();
      dialog.remove();
      const button = screen.querySelector(`[data-view-attempt="${reopen}"]`);
      if (button) {
        button.focus();
      }
    });

    dialog.querySelector("[data-close-student]").addEventListener("click", close);
    // A click on the backdrop (the dialog itself, outside its content) closes it.
    dialog.addEventListener("click", event => {
      if (event.target === dialog) {
        close();
      }
    });

    dialog.querySelectorAll("[data-answer-row]").forEach(details => {
      details.addEventListener("toggle", () => {
        const id = details.getAttribute("data-answer-row");
        if (details.open) {
          state.openAnswerRows.add(id);
        } else {
          state.openAnswerRows.delete(id);
        }
      });
    });

    dialog.querySelectorAll("[data-jump-answer]").forEach(button => {
      button.addEventListener("click", () => {
        const row = dialog.querySelector(`[data-answer-row="${CSS.escape(button.getAttribute("data-jump-answer"))}"]`);
        if (row) {
          row.open = true;
          row.scrollIntoView({ block: "start", behavior: "smooth" });
          row.querySelector("summary").focus({ preventScroll: true });
        }
      });
    });
  }

  function bindOutcomesSummaryEvents() {
    Array.from(screen.querySelectorAll("[data-sort-key]")).forEach(button => {
      button.addEventListener("click", () => {
        const key = button.getAttribute("data-sort-key");
        state.outcomesSort = state.outcomesSort.key === key
          ? { key, dir: state.outcomesSort.dir === "asc" ? "desc" : "asc" }
          : { key, dir: "asc" };
        renderDashboard();
      });
    });
  }

  // ---------- Editing an event's settings ----------

  const SETTING_FIELD_LABELS = {
    title: "Title",
    feedback_mode: "Feedback",
    navigation_mode: "Navigation",
    duration_minutes: "Time limit",
    start_at: "Opens",
    end_at: "Deadline",
    questions: "Questions"
  };

  function formatTime(iso) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  // An ISO time as a datetime-local value in the teacher's own zone.
  function toLocalInput(iso) {
    if (!iso) {
      return "";
    }

    const date = new Date(iso);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  // Where the event's questions came from, for its card.
  function presetLine(event) {
    if (!event.preset) {
      return "Custom selection";
    }

    return `From preset: ${event.preset.summary}${event.preset.customised ? ", then customised" : ""}`;
  }

  // One audit value in words.
  function settingValueText(field, value) {
    if (field === "feedback_mode") {
      return FEEDBACK_LABELS[value] || value;
    }

    if (field === "navigation_mode") {
      return NAVIGATION_LABELS[value] || value;
    }

    if (field === "duration_minutes") {
      return value === null ? "No time limit" : `${value} min`;
    }

    if (field === "start_at" || field === "end_at") {
      return value === null ? "Not set" : formatTime(value);
    }

    return value === null ? "None" : value;
  }

  function renderSettingsHistory(changes) {
    if (!changes || !changes.length) {
      return "";
    }

    return resultsSection("history", "Settings history", plural(changes.length, "change"), `
        <ol class="history__list">
          ${changes.map(change => `
            <li class="history__item">
              <span class="muted small">${escapeHtml(formatTime(change.changedAt))}</span>
              <span><strong>${escapeHtml(SETTING_FIELD_LABELS[change.field] || change.field)}</strong>:
                ${escapeHtml(settingValueText(change.field, change.oldValue))} &rarr; ${escapeHtml(settingValueText(change.field, change.newValue))}</span>
              ${change.changedBy ? `<span class="muted small">${escapeHtml(change.changedBy)}</span>` : ""}
            </li>
          `).join("")}
        </ol>
    `);
  }

  // The form's starting values, so only fields the teacher touched are sent.
  function editFormValues(event) {
    return {
      title: event.title,
      feedbackMode: event.feedback_mode || "release",
      navigationMode: event.navigation_mode || "free",
      durationMinutes: event.duration_minutes ? String(event.duration_minutes) : "",
      startAt: toLocalInput(event.start_at),
      endAt: toLocalInput(event.end_at)
    };
  }

  // Shown when the feedback radio the teacher has selected is stricter than
  // the event's current setting. Tightening cannot take back a key a student
  // has already seen, only stop showing it from now on.
  function editFeedbackWarningHtml(originalMode, selectedMode) {
    return tightensFeedback(originalMode, selectedMode)
      ? `<p class="notice notice--warning" id="editFeedbackWarning">Students who already saw answers keep what they saw; this only stops showing them from now on.</p>`
      : `<span id="editFeedbackWarning" hidden></span>`;
  }

  function renderEditSettings(event) {
    const values = editFormValues(event);
    const radios = (name, labels) => Object.keys(labels).map(value => `
      <label class="check">
        <input type="radio" name="edit-${name}" value="${value}" ${values[name] === value ? "checked" : ""} />
        ${escapeHtml(labels[value])}
      </label>
    `).join("");

    return `
      <form class="edit-settings" id="editSettingsForm" novalidate>
        <div class="section-heading">
          <h3>Edit settings</h3>
        </div>
        <p class="notice">Students already taking the test pick up changes on their next move, or within 30 seconds. A new time limit or deadline resets each student's own end time (their start plus the limit, or the deadline if sooner); anyone now past it has their answers sent and marked late. Answers students have locked stay locked, and switching to in order moves each student on to their first unanswered question.</p>
        <div class="form-grid">
          <div class="field field--full">
            <label for="editTitle">Title</label>
            <input id="editTitle" type="text" value="${escapeHtml(values.title)}" />
          </div>
          <div class="field">
            <label for="editDuration">Time limit, min <span class="field__hint">empty for none</span></label>
            <input id="editDuration" type="number" min="1" value="${escapeHtml(values.durationMinutes)}" />
          </div>
          <div class="field">
            <label for="editStartAt">Opens <span class="field__hint">optional</span></label>
            <input id="editStartAt" type="datetime-local" value="${escapeHtml(values.startAt)}" />
          </div>
          <div class="field">
            <label for="editEndAt">Deadline <span class="field__hint">optional</span></label>
            <input id="editEndAt" type="datetime-local" value="${escapeHtml(values.endAt)}" />
          </div>
          <fieldset class="setting field--full">
            <legend class="legend">Students see which answers were right</legend>
            <div class="setting__options">${radios("feedbackMode", { each: "After each question", end: "At the end of the test", release: "When I release them" })}</div>
            ${editFeedbackWarningHtml(values.feedbackMode, values.feedbackMode)}
          </fieldset>
          <fieldset class="setting field--full">
            <legend class="legend">Moving between questions</legend>
            <div class="setting__options">${radios("navigationMode", { free: "Free: back, next and skip", linear: "In order: forward only" })}</div>
          </fieldset>
        </div>
        <p class="muted small mt-s">The questions can't be changed here. Use Change questions on the event, which is available while no student has a live attempt.</p>
        <div class="form-actions">
          <button type="button" class="btn btn--secondary" id="cancelEditBtn">Cancel</button>
          <button type="submit" class="btn btn--accent" id="saveEditBtn">Save changes</button>
        </div>
      </form>
    `;
  }

  function bindEditSettings(event) {
    const form = document.getElementById("editSettingsForm");

    if (!form) {
      return;
    }

    const originalFeedbackMode = editFormValues(event).feedbackMode;

    form.querySelectorAll('input[name="edit-feedbackMode"]').forEach(input => {
      input.addEventListener("change", () => {
        document.getElementById("editFeedbackWarning").outerHTML = editFeedbackWarningHtml(originalFeedbackMode, input.value);
      });
    });

    document.getElementById("cancelEditBtn").addEventListener("click", () => {
      state.editingSettings = false;
      renderDashboard();
    });

    form.addEventListener("submit", async submitEvent => {
      submitEvent.preventDefault();
      const before = editFormValues(event);
      const now = {
        title: document.getElementById("editTitle").value.trim(),
        feedbackMode: form.querySelector('input[name="edit-feedbackMode"]:checked').value,
        navigationMode: form.querySelector('input[name="edit-navigationMode"]:checked').value,
        durationMinutes: document.getElementById("editDuration").value,
        startAt: document.getElementById("editStartAt").value,
        endAt: document.getElementById("editEndAt").value
      };
      const body = {};

      Object.keys(now).forEach(key => {
        if (now[key] === before[key]) {
          return;
        }

        if (key === "durationMinutes") {
          body[key] = now[key] ? Number(now[key]) : null;
        } else if (key === "startAt" || key === "endAt") {
          // datetime-local has no zone: read it in the teacher's own zone.
          body[key] = now[key] ? new Date(now[key]).toISOString() : null;
        } else {
          body[key] = now[key];
        }
      });

      if (!Object.keys(body).length) {
        state.editingSettings = false;
        renderDashboard();
        return;
      }

      await withBusy(document.getElementById("saveEditBtn"), async () => {
        try {
          await api(`/api/events/${event.id}`, { method: "PATCH", body: JSON.stringify(body) });
          state.editingSettings = false;
          const eventsPayload = await api("/api/events", { method: "GET" });
          state.events = eventsPayload.events;
          await loadResults(event.id);
        } catch (error) {
          alert(error.message);
        }
      }, "Saving\u2026");
    });
  }

  // ---------- Event list (and an admin's filter, ADR 0004) ----------

  function isAdmin() {
    return Boolean(state.user) && state.user.role === "admin";
  }

  // The teachers who own at least one event, for an admin's teacher filter.
  function eventOwners() {
    return Array.from(new Set(state.events.map(event => event.owner_email).filter(Boolean))).sort();
  }

  function visibleEvents() {
    if (!isAdmin()) {
      return state.events;
    }

    if (state.eventFilter.scope === "mine") {
      return state.events.filter(event => event.owned);
    }

    return state.eventFilter.owner
      ? state.events.filter(event => event.owner_email === state.eventFilter.owner)
      : state.events;
  }

  function renderEventFilter() {
    if (!isAdmin()) {
      return "";
    }

    const scope = state.eventFilter.scope;
    const scopeButton = (value, label) => `<button type="button" class="segmented__btn" data-event-scope="${value}" aria-pressed="${scope === value}">${label}</button>`;

    return `
      <div class="event-filter card__pad">
        <div class="segmented" role="group" aria-label="Whose events">
          ${scopeButton("all", "All teachers")}
          ${scopeButton("mine", "Mine")}
        </div>
        ${scope === "all" ? `
          <label class="visually-hidden" for="eventOwnerFilter">Teacher</label>
          <select id="eventOwnerFilter">
            <option value="">Any teacher</option>
            ${eventOwners().map(email => `<option value="${escapeHtml(email)}" ${state.eventFilter.owner === email ? "selected" : ""}>${escapeHtml(email)}</option>`).join("")}
          </select>
        ` : ""}
      </div>
    `;
  }

  // Which question bank an event draws on, in a word. Kept on the compact
  // row so an event titled for one cohort but built from another bank shows.
  function audienceText(event) {
    const audiences = event.filter && Array.isArray(event.filter.audiences) && event.filter.audiences.length
      ? event.filter.audiences
      : ["core"];

    return audiences.map(id => AUDIENCE_SHORT[id] || id).join(" + ");
  }

  // What an event is made of, from its frozen question snapshot: the count by
  // response type, and how many questions sit at each difficulty (1 easiest to
  // 5 hardest, ADR 0001). Every difficulty is shown, empty ones as 0, so two
  // events can be compared at a glance.
  function renderEventComposition(questions) {
    if (!questions || !questions.length) {
      return "";
    }

    const labelOrder = Object.keys(QP_TYPE_LABELS);
    const typeCounts = questions.reduce((acc, question) => ({ ...acc, [question.type]: (acc[question.type] || 0) + 1 }), {});
    const types = Object.keys(typeCounts)
      .sort((a, b) => typeCounts[b] - typeCounts[a] || labelOrder.indexOf(a) - labelOrder.indexOf(b))
      .map(type => `${typeCounts[type]} ${QP_TYPE_LABELS[type] || type}`);

    const levels = [1, 2, 3, 4, 5];
    const counts = levels.map(level => questions.filter(question => question.difficulty === level).length);
    const most = Math.max(...counts);
    const columns = levels.map((level, i) => {
      const label = `Difficulty ${level}: ${counts[i]} question${counts[i] === 1 ? "" : "s"}`;

      return `
        <li class="dh__col" aria-label="${label}" title="${label}">
          <span class="dh__count">${counts[i]}</span>
          <span class="dh__slot">${counts[i] ? `<span class="dh__bar" style="height:${Math.round((counts[i] / most) * 100)}%"></span>` : ""}</span>
          <span class="dh__level">${level}</span>
        </li>`;
    }).join("");

    return `
      <div class="composition">
        <p class="composition__types"><strong>${questions.length} question${questions.length === 1 ? "" : "s"}:</strong> ${escapeHtml(types.join(", "))}</p>
        <figure class="dh" role="group" aria-label="Questions by difficulty">
          <figcaption class="dh__caption">Questions by difficulty <span class="muted">(1 easiest, 5 hardest)</span></figcaption>
          <ul class="dh__cols">${columns}</ul>
        </figure>
      </div>`;
  }

  // One compact row per event: title and join code, then the facts a teacher
  // scans for. The full summary and settings are on the event's own view.
  function renderEventList() {
    const events = visibleEvents();
    const cards = events.map(event => {
      const active = (state.view === "event" || state.view === "questions") && state.selectedEventId === event.id;
      const facts = [
        audienceText(event),
        `${event.question_count} question${event.question_count === 1 ? "" : "s"}`,
        `${event.attempt_count} attempt${event.attempt_count === 1 ? "" : "s"}`,
        event.duration_minutes ? `${event.duration_minutes} min` : "No time limit"
      ];

      return `
        <li>
          <button class="event-card ${active ? "event-card--active" : ""}" data-event-id="${event.id}" ${active ? `aria-current="true"` : ""}>
            <span class="event-card__title">${escapeHtml(event.title)}</span>
            <span class="tag tag--code">${escapeHtml(event.join_code)}</span>
            <span class="event-card__meta">
              ${isAdmin() ? `<span class="event-card__owner">${event.owned ? "Yours" : escapeHtml(event.owner_email || "Unknown teacher")}</span>` : ""}
              <span>${facts.map(escapeHtml).join(" · ")}</span>
            </span>
          </button>
        </li>
      `;
    }).join("");

    if (cards) {
      return `<ul class="event-list">${cards}</ul>`;
    }

    return state.events.length
      ? `<p class="muted card__pad">No events match this filter.</p>`
      : `<p class="muted card__pad">No events yet. Use New event to make one.</p>`;
  }

  function bindEventListEvents() {
    Array.from(screen.querySelectorAll("[data-event-id]")).forEach(button => {
      button.addEventListener("click", () => openEvent(Number(button.getAttribute("data-event-id"))));
    });

    Array.from(screen.querySelectorAll("[data-event-scope]")).forEach(button => {
      button.addEventListener("click", () => {
        state.eventFilter = { scope: button.getAttribute("data-event-scope"), owner: "" };
        refreshEventList(`[data-event-scope="${state.eventFilter.scope}"]`);
      });
    });

    const ownerFilter = document.getElementById("eventOwnerFilter");

    if (ownerFilter) {
      ownerFilter.addEventListener("change", () => {
        state.eventFilter = { ...state.eventFilter, owner: ownerFilter.value };
        refreshEventList("#eventOwnerFilter");
      });
    }
  }

  // Filtering redraws only the list, so the new event form keeps what the
  // teacher has typed. Focus goes back to the control they just used.
  function refreshEventList(focusSelector) {
    const el = document.getElementById("eventListBody");

    if (!el) {
      return;
    }

    el.innerHTML = renderEventFilter() + renderEventList();
    bindEventListEvents();

    const focusTarget = focusSelector ? el.querySelector(focusSelector) : null;
    if (focusTarget) {
      focusTarget.focus();
    }
  }

  // ---------- Question bank ----------
  // A review workbench: the list of every question on the left, and for the
  // selected one a pane with the question as a student sees it (answerable,
  // nothing saved or sent), the answer key behind a toggle, and a slot for
  // the controls in bank-controls.js. The bank is fetched once from
  // GET /api/question-bank as entries ({ teacher, public, overlay, original,
  // comments }) and fetched again after a change (refresh).

  const BANK_OVERRIDE_FIELDS = ["level", "points", "topic", "qType", "difficulty", "ontology", "outcomes", "details"];

  const BANK_STATUS_CHOICES = [
    ["flagged", "Flagged"],
    ["retired", "Retired"],
    ["comments", "Has comments"],
    ["edited", "Has an override"]
  ];

  // The student renderers are registered by CTQuestTypes.load(), which must
  // finish before any card is drawn. Kept so it runs once; a failure clears
  // it so opening the bank again retries.
  let bankTypesReady = null;

  function loadBankTypes() {
    if (!bankTypesReady) {
      bankTypesReady = window.CTQuestTypes.load().catch(error => {
        bankTypesReady = null;
        throw error;
      });
    }

    return bankTypesReady;
  }

  async function loadBank() {
    try {
      await loadBankTypes();
      const payload = await api("/api/question-bank");
      state.bank = payload.questions;
      state.bankError = null;
    } catch (error) {
      state.bank = null;
      state.bankError = error.message;
    }
  }

  function bankIsEdited(entry) {
    return Boolean(entry.overlay) && BANK_OVERRIDE_FIELDS.some(key => entry.overlay[key] !== null && entry.overlay[key] !== undefined);
  }

  function bankIsFlagged(entry) {
    return Boolean(entry.overlay && entry.overlay.flagged);
  }

  function bankIsRetired(entry) {
    return Boolean(entry.overlay && entry.overlay.retired);
  }

  function bankMatches(entry) {
    const f = state.bankFilter;
    const question = entry.teacher;
    const text = f.q.trim().toLowerCase();
    const status = {
      flagged: bankIsFlagged,
      retired: bankIsRetired,
      comments: item => item.comments.length > 0,
      edited: bankIsEdited
    }[f.status];

    return (!f.audience || question.audience === f.audience)
      && (!f.level || question.level === f.level)
      && (!f.type || question.type === f.type)
      && (!f.outcome || (question.outcomes || []).includes(f.outcome))
      && (!status || status(entry))
      && (!text || [question.id, question.title, question.prompt, question.topic]
        .some(value => value && String(value).toLowerCase().includes(text)));
  }

  function bankSelect(id, label, current, choices) {
    return `
      <div class="field">
        <label for="${id}">${escapeHtml(label)}</label>
        <select id="${id}">
          <option value="">All</option>
          ${choices.map(([value, text]) => `<option value="${escapeHtml(value)}" ${current === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}
        </select>
      </div>
    `;
  }

  // The status badges on a row: a word for each, in the tone it means.
  // Flagged is a warning, retired is neutral (out of use, not a problem),
  // an edit or comments are facts, so they are plain tags.
  function bankBadges(entry) {
    const badges = [];

    if (bankIsFlagged(entry)) {
      badges.push(`<span class="tag status status--warning">Flagged</span>`);
    }

    if (bankIsRetired(entry)) {
      badges.push(`<span class="tag status status--neutral">Retired</span>`);
    }

    if (entry.overlay && entry.overlay.stale) {
      badges.push(`<span class="tag status status--warning">Edit out of date</span>`);
    }

    if (bankIsEdited(entry)) {
      badges.push(`<span class="tag">Edited</span>`);
    }

    if (entry.comments.length) {
      badges.push(`<span class="tag">${entry.comments.length} comment${entry.comments.length === 1 ? "" : "s"}</span>`);
    }

    return badges.join("");
  }

  function bankRow(entry) {
    const question = entry.teacher;
    const selected = question.id === state.bankSelected;

    return `
      <li>
        <button type="button" class="qr-row ${bankIsRetired(entry) ? "qr-row--retired" : ""}" data-qr-id="${escapeHtml(question.id)}" ${selected ? `aria-current="true"` : ""}>
          <span class="qr-row__title">${escapeHtml(question.title)}</span>
          <span class="qr-row__meta">
            <span class="muted small mono">${escapeHtml(question.id)}</span>
            <span class="tag">${escapeHtml(QP_TYPE_LABELS[question.type] || question.type)}</span>
            <span class="concept-tag">${escapeHtml(question.level)}</span>
            <span class="muted small">${question.points} pt${question.points === 1 ? "" : "s"}</span>
          </span>
          ${bankBadges(entry) ? `<span class="qr-row__meta">${bankBadges(entry)}</span>` : ""}
        </button>
      </li>
    `;
  }

  function renderBankList() {
    if (state.bankError) {
      return `<p class="notice notice--critical">${escapeHtml(state.bankError)}</p>`;
    }

    if (!state.bank) {
      return `<div class="sk-list" role="status"><span class="visually-hidden-b">Loading the question bank&hellip;</span>${skeletonRows(6)}</div>`;
    }

    const shown = state.bank.filter(bankMatches);

    return `
      <p class="muted small bank__count" aria-live="polite">${shown.length} of ${state.bank.length} question${state.bank.length === 1 ? "" : "s"}</p>
      ${shown.length ? `<ol class="qr-list">${shown.map(bankRow).join("")}</ol>` : `<p class="muted small">No questions match these filters.</p>`}
    `;
  }

  function renderBankFilters() {
    const f = state.bankFilter;
    const bank = (state.bank || []).map(entry => entry.teacher);
    const distinct = key => Array.from(new Set(bank.map(question => question[key]).filter(Boolean)));
    const levelOrder = state.catalog ? state.catalog.levels.map(level => level.id) : [];
    const levels = distinct("level").sort((a, b) => levelOrder.indexOf(a) - levelOrder.indexOf(b));
    const usedOutcomes = new Set(bank.flatMap(question => question.outcomes || []));
    const outcomes = (state.outcomes || []).filter(outcome => usedOutcomes.has(outcome.id));

    return `
      ${bankSelect("bankAudience", "Audience", f.audience, distinct("audience").map(id => [id, AUDIENCE_SHORT[id] || id]))}
      ${bankSelect("bankType", "Type", f.type, distinct("type").map(id => [id, QP_TYPE_LABELS[id] || id]))}
      ${bankSelect("bankLevel", "Level", f.level, levels.map(id => [id, id]))}
      ${bankSelect("bankStatus", "Status", f.status, BANK_STATUS_CHOICES)}
      ${bankSelect("bankOutcome", "Learning outcome", f.outcome, outcomes.map(outcome => [outcome.id, truncate(outcome.statement, 70)]))}
      <div class="field">
        <label for="bankSearch">Search</label>
        <input id="bankSearch" type="search" placeholder="Id, title or prompt" value="${escapeHtml(f.q)}" />
      </div>
    `;
  }

  function renderBank() {
    return `
      <section class="card" aria-labelledby="bankHeading">
        <div class="section-heading">
          <h2 id="bankHeading">Question bank</h2>
          <p>Every question students can be given. Pick one to try it as a student would, then show its answer key. Use J and K, or the arrow keys, to move between questions.</p>
        </div>
        <div class="bank__filters" id="bankFilters">${renderBankFilters()}</div>
        <div class="qr">
          <div class="qr-index" id="bankList">${renderBankList()}</div>
          <div class="qr-pane" id="bankPane" aria-label="Selected question"></div>
        </div>
      </section>
    `;
  }

  function bankEntry(id) {
    return (state.bank || []).find(entry => entry.teacher.id === id) || null;
  }

  // What the pane shows for the selected question. Only one student card is
  // ever in the page: the renderers use fixed element ids (answerArea,
  // openResponse...), and this replaces the whole pane, so the previous card
  // is gone before the next is built.
  //
  // The student page saves and submits from listeners on its answer area;
  // this pane attaches none, so an answer typed here goes nowhere. The type
  // renderers wire their own behaviour (dragging, run buttons, code
  // reading notes) from document-level listeners and need nothing more.
  function renderBankPane() {
    const entry = state.bank && bankEntry(state.bankSelected);

    if (!entry) {
      return `<p class="muted qr-empty">${state.bank ? "Select a question to review it." : ""}</p>`;
    }

    const h = { escapeHtml };
    const question = entry.public;
    let student;

    try {
      student = `
        ${window.CTQuestView.questionCard(question, h)}
        <section class="card" aria-label="Try an answer">
          <p class="muted small qr-practice">Try it: nothing you enter here is saved or sent.</p>
          ${window.CTQuestView.answerCard(question, null, { locked: false, h })}
        </section>
      `;
    } catch (error) {
      student = `<p class="notice notice--critical">${escapeHtml(error.message)}</p>`;
    }

    return `
      <div class="qr-student">${student}</div>
      <div class="qr-key">
        <button type="button" class="btn btn--secondary btn--sm" data-qr-key-toggle aria-expanded="${state.bankShowAnswer}" aria-controls="bankKey">${state.bankShowAnswer ? "Hide answer" : "Show answer"}</button>
        <div id="bankKey" class="qp-row__body qr-key__body" ${state.bankShowAnswer ? "" : "hidden"}>${state.bankShowAnswer ? bankKeyBody(entry.teacher) : ""}</div>
      </div>
      <div class="qr-controls" data-qr-controls></div>
    `;
  }

  // The answer key and teacher notes, drawn only while shown so the page
  // holds one copy of a question's content at a time.
  function bankKeyBody(question) {
    return `${qpTypeBody(question)}${qpTeacherOnly(question)}`;
  }

  function mountBankPane() {
    const pane = document.getElementById("bankPane");
    const entry = state.bank && bankEntry(state.bankSelected);

    if (!pane) {
      return;
    }

    pane.innerHTML = renderBankPane();

    const toggle = pane.querySelector("[data-qr-key-toggle]");

    if (toggle) {
      toggle.addEventListener("click", () => {
        state.bankShowAnswer = !state.bankShowAnswer;
        const key = pane.querySelector("#bankKey");
        key.hidden = !state.bankShowAnswer;
        key.innerHTML = state.bankShowAnswer ? bankKeyBody(entry.teacher) : "";
        toggle.textContent = state.bankShowAnswer ? "Hide answer" : "Show answer";
        toggle.setAttribute("aria-expanded", String(state.bankShowAnswer));
      });
    }

    const slot = pane.querySelector("[data-qr-controls]");

    // bank-controls.js is loaded by its own script tag and may be absent.
    if (entry && slot && window.QuestBankControls) {
      window.QuestBankControls.render(entry, slot, { refresh: refreshBank, isAdmin: isAdmin() });
    }
  }

  function refreshBankList() {
    const el = document.getElementById("bankList");

    if (el) {
      el.innerHTML = renderBankList();
    }
  }

  // Re-fetches the bank after a change and redraws the list, filters and
  // pane, keeping the selection.
  async function refreshBank() {
    await loadBank();

    if (state.view !== "bank") {
      return;
    }

    const filters = document.getElementById("bankFilters");

    if (filters) {
      filters.innerHTML = renderBankFilters();
      bindBankFilters();
    }

    refreshBankList();
    mountBankPane();
  }

  function selectBankQuestion(id, { scroll = false } = {}) {
    if (id === state.bankSelected || !bankEntry(id)) {
      return;
    }

    state.bankSelected = id;
    history.replaceState(null, "", `#q=${encodeURIComponent(id)}`);

    document.querySelectorAll("#bankList [data-qr-id]").forEach(row => {
      const current = row.dataset.qrId === id;

      if (current) {
        row.setAttribute("aria-current", "true");
        if (scroll) {
          row.scrollIntoView({ block: "nearest" });
        }
      } else {
        row.removeAttribute("aria-current");
      }
    });

    mountBankPane();
  }

  function bankHashId() {
    const match = /^#q=(.+)$/.exec(location.hash);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function bindBankFilters() {
    [["bankAudience", "audience"], ["bankType", "type"], ["bankLevel", "level"], ["bankStatus", "status"], ["bankOutcome", "outcome"]].forEach(([id, key]) => {
      const select = document.getElementById(id);
      if (select) {
        select.addEventListener("change", () => {
          state.bankFilter = { ...state.bankFilter, [key]: select.value };
          refreshBankList();
        });
      }
    });

    const search = document.getElementById("bankSearch");

    if (search) {
      search.addEventListener("input", () => {
        state.bankFilter = { ...state.bankFilter, q: search.value };
        refreshBankList();
      });
    }
  }

  function bindBankEvents() {
    bindBankFilters();

    const list = document.getElementById("bankList");

    if (list) {
      list.addEventListener("click", event => {
        const row = event.target.closest("[data-qr-id]");

        if (row) {
          selectBankQuestion(row.dataset.qrId);

          // Stacked on a narrow screen, the pane is below the list.
          if (getComputedStyle(list).position !== "sticky") {
            document.getElementById("bankPane").scrollIntoView({ block: "start" });
          }
        }
      });
    }

    // The pane is filled here, once the page around it exists. The first
    // draw of the dashboard clears the hash, so a selection restored from
    // it is written back.
    if (state.bank) {
      if (state.bankSelected && bankEntry(state.bankSelected)) {
        history.replaceState(null, "", `#q=${encodeURIComponent(state.bankSelected)}`);
      }

      mountBankPane();
    }
  }

  // J/K and the arrow keys move through the questions in the list, unless
  // the key is meant for something else: a field, or the pane's widgets.
  document.addEventListener("keydown", event => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const down = key === "j" || key === "ArrowDown";
    const up = key === "k" || key === "ArrowUp";

    if (state.view !== "bank" || !state.bank || (!down && !up) || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.target.closest && event.target.closest("input, textarea, select, [contenteditable]")) {
      return;
    }

    // Arrow keys belong to the pane's own widgets (the code editor, a radio
    // group); J and K still move the selection from a button there.
    if (event.key.startsWith("Arrow") && event.target.closest && event.target.closest(".qr-pane")) {
      return;
    }

    const shown = state.bank.filter(bankMatches);

    if (!shown.length) {
      return;
    }

    event.preventDefault();

    const index = shown.findIndex(entry => entry.teacher.id === state.bankSelected);
    const next = index === -1 ? 0 : Math.min(shown.length - 1, Math.max(0, index + (down ? 1 : -1)));

    selectBankQuestion(shown[next].teacher.id, { scroll: true });

    const row = document.querySelector(`#bankList [data-qr-id="${CSS.escape(shown[next].teacher.id)}"]`);

    if (row && document.activeElement !== row) {
      row.focus({ preventScroll: true });
    }
  });

  async function openBank() {
    state.view = "bank";
    state.editingSettings = false;
    renderDashboard();
    window.scrollTo({ top: 0 });

    if (!state.bank) {
      await loadBank();
      if (state.view === "bank") {
        renderDashboard();
      }
    }
  }

  // ---------- Dashboard ----------

  function renderDashboard() {
    // The hash names a question only while the bank is open.
    if (state.view !== "bank" && bankHashId()) {
      history.replaceState(null, "", location.pathname + location.search);
    }

    const attemptStatus = attempt => attempt.reset_at
      ? `<span class="tag status status--neutral">Reset</span>`
      : attempt.status === "submitted"
        ? `<span class="tag status status--positive">Submitted</span>`
        : `<span class="tag status status--pending">${escapeHtml(attempt.status === "started" ? "In progress" : attempt.status)}</span>`;

    const resultsEvent = state.results && state.results.event;
    // An admin reading another teacher's event sees everything but cannot
    // change it (ADR 0004); the server refuses those changes with 403 too.
    const canManage = Boolean(resultsEvent && resultsEvent.can_manage);
    // Attempts that are not reset block a change of questions (ADR 0003 §10).
    const liveAttempts = Boolean(state.results && state.results.attempts.some(attempt => !attempt.reset_at));
    const resultsBlock = state.results
      ? `
        <section class="card">
          <div class="results-head">
            <div class="row">
              <h2>${escapeHtml(resultsEvent.title)}</h2>
              <span class="tag tag--code">${escapeHtml(resultsEvent.join_code)}</span>
            </div>
            <div class="row">
              <span class="tag">${escapeHtml(FEEDBACK_LABELS[resultsEvent.feedback_mode] || FEEDBACK_LABELS.release)}</span>
              <span class="tag">${escapeHtml(NAVIGATION_LABELS[resultsEvent.navigation_mode] || NAVIGATION_LABELS.free)}</span>
              ${resultsEvent.feedback_mode === "each"
                ? `<span class="tag status status--positive">Students see each result as they answer</span>`
                : resultsEvent.feedback_mode === "end"
                  ? `<span class="tag status status--positive">Students see their breakdown on submit</span>`
                  : resultsEvent.breakdown_released
                    ? `<span class="tag status status--positive">Students can see their breakdown</span>`
                    : `<span class="tag status status--neutral">Breakdown hidden from students</span>`}
              ${!canManage || resultsEvent.results_released_at || (resultsEvent.feedback_mode && resultsEvent.feedback_mode !== "release") ? "" : `<button id="releaseBtn" class="btn btn--accent btn--sm">Release results</button>`}
              ${!canManage || state.editingSettings ? "" : `<button id="editSettingsBtn" class="btn btn--secondary btn--sm">Edit settings</button>`}
              ${!canManage ? "" : liveAttempts
                ? `<button type="button" class="btn btn--secondary btn--sm" disabled>Change questions</button><span class="muted small">Reset every attempt to change the questions.</span>`
                : `<button type="button" id="editQuestionsBtn" class="btn btn--secondary btn--sm">Change questions</button>`}
            </div>
          </div>
          <p class="muted small results-facts">
            ${escapeHtml(presetLine(resultsEvent))} · ${escapeHtml(resultsEvent.filter_summary || resultsEvent.selection_mode)} ·
            ${resultsEvent.duration_minutes ? `${resultsEvent.duration_minutes} min` : "No time limit"}${resultsEvent.end_at ? ` · Deadline ${escapeHtml(formatTime(resultsEvent.end_at))}` : ""}
          </p>
          ${canManage ? "" : `<p class="notice read-only">Read only: this is ${escapeHtml(resultsEvent.owner_email || "another teacher")}'s event. Only they can reset attempts, release results, edit settings or mark answers.</p>`}
          ${canManage && state.editingSettings ? renderEditSettings(resultsEvent) : ""}
          ${resultTiles(canManage)}
          ${sectionControls()}
          ${overviewSection()}
          ${questionsSection()}
          ${outcomesSection()}
          ${capabilitiesSection()}
          ${resultsSection("students", "Students", plural(state.results.attempts.length, "attempt"), state.results.attempts.length
            ? `<ul class="attempts">${state.results.attempts.map(attempt => `
              <li class="attempt">
                <div class="attempt__row">
                  <span class="attempt__who"><strong>${escapeHtml(attempt.student_name)}</strong> <span class="muted small">${escapeHtml(attempt.student_group)}</span></span>
                  <span class="row">
                    ${attemptStatus(attempt)}
                    ${attempt.late ? `<span class="tag status status--warning">Late</span>` : ""}
                    ${markingBadges(attempt)}
                    <span class="muted small">${attempt.submitted_at ? formatTime(attempt.submitted_at) : "Not submitted"}</span>
                  </span>
                  <span class="attempt__score">${attempt.max_score === null ? "&ndash;" : `${attempt.score ?? 0}/${attempt.max_score}`}</span>
                  <span class="attempt__actions">
                    <button type="button" class="btn btn--secondary btn--sm" data-view-attempt="${attempt.id}" aria-haspopup="dialog" aria-label="View ${escapeHtml(attempt.student_name)}'s answers">View</button>
                    ${attempt.reset_at || !canManage ? "" : `<button class="btn btn--destructive btn--sm" data-reset-attempt="${attempt.id}" aria-label="Reset attempt for ${escapeHtml(attempt.student_name)}">Reset</button>`}
                  </span>
                </div>
              </li>
            `).join("")}</ul>`
            : `<p class="muted">No submissions yet.</p>`)}
          ${renderSettingsHistory(state.results.settingChanges)}
          ${renderStudentDialog(canManage)}
        </section>
      `
      : "";

    const createBlock = `
          <section class="card" aria-labelledby="newEventHeading">
            <div class="section-heading">
              <h2 id="newEventHeading">New event</h2>
            </div>
            <div class="form-grid">
              <div class="field field--full">
                <label for="title">Title</label>
                <input id="title" type="text" placeholder="P6 Mock Round 1" />
              </div>
              ${state.presets ? renderQuickSetup() : `
                <div class="field field--full">
                  <label for="selectionMode">Question set</label>
                  <select id="selectionMode">
                    <option value="ALL">All levels</option>
                    <option value="P5">P5 only</option>
                    <option value="P6">P6 only</option>
                    <option value="S1">S1 only</option>
                    <option value="S2">S2 only</option>
                  </select>
                </div>
              `}

              <details id="advancedPicker">
                <summary>${state.presets ? "Customise" : "Choose what to test"}</summary>
                <div id="advancedPickerBody">${renderAdvancedPicker()}</div>
              </details>

              <div class="field">
                <label for="joinCode">Join code <span class="field__hint">optional</span></label>
                <input id="joinCode" type="text" placeholder="Made for you" autocapitalize="characters" spellcheck="false" />
              </div>
              <div class="field">
                <label for="durationMinutes">Time limit, min <span class="field__hint">optional</span></label>
                <input id="durationMinutes" type="number" min="1" placeholder="45" />
              </div>
              <div class="field">
                <label for="startAt">Opens <span class="field__hint">optional</span></label>
                <input id="startAt" type="datetime-local" />
              </div>
              <div class="field">
                <label for="endAt">Deadline <span class="field__hint">optional</span></label>
                <input id="endAt" type="datetime-local" />
              </div>

              ${renderSettings()}
            </div>

            <div class="form-actions">
              <button id="createEventBtn" class="btn btn--accent">Create event</button>
            </div>
          </section>
    `;

    // The New event screen's question picker, on its own, for an event that
    // has no live attempt. It starts from the event's current selection.
    const changingEvent = state.view === "questions" && state.results ? state.results.event : null;
    const questionsBlock = changingEvent ? `
          <section class="card" aria-labelledby="changeQuestionsHeading">
            <div class="section-heading">
              <h2 id="changeQuestionsHeading">Change questions</h2>
              <p>${escapeHtml(changingEvent.title)} <span class="tag tag--code">${escapeHtml(changingEvent.join_code)}</span></p>
            </div>
            <p class="notice">Now: ${escapeHtml(changingEvent.filter_summary || changingEvent.selection_mode)} (${(state.eventQuestions || []).length} questions). The new selection replaces all of them. Attempts that were reset stay in the results as history.${changingEvent.filter && changingEvent.filter.questionIds && changingEvent.filter.questionIds.length ? " This event uses a fixed list of chosen questions, which the picker cannot recreate: the picker below builds a new selection instead." : ""}</p>
            <div class="form-grid">
              ${state.presets ? renderQuickSetup() : `
                <div class="field field--full">
                  <label for="selectionMode">Question set</label>
                  <select id="selectionMode">
                    ${["ALL", "P5", "P6", "S1", "S2"].map(mode => `<option value="${mode}" ${changingEvent.selection_mode === mode ? "selected" : ""}>${mode === "ALL" ? "All levels" : `${mode} only`}</option>`).join("")}
                  </select>
                </div>
              `}

              <details id="advancedPicker" ${state.quick ? "" : "open"}>
                <summary>${state.presets ? "Customise" : "Choose what to test"}</summary>
                <div id="advancedPickerBody">${renderAdvancedPicker()}</div>
              </details>
            </div>

            <div class="form-actions">
              <button type="button" id="cancelQuestionsBtn" class="btn btn--secondary">Cancel</button>
              <button id="createEventBtn" class="btn btn--accent">Save questions</button>
            </div>
          </section>
    ` : "";

    const emptyBlock = `
          <section class="card card--raised">
            <div class="section-heading">
              <h2>${state.events.length ? "Pick an event" : "No events yet"}</h2>
              <p>${state.events.length ? "Choose one from the list to see its results, questions and settings, or start a new one." : "Create an event to get a join code for your students."}</p>
            </div>
            <div class="form-actions form-actions--start">
              <button type="button" class="btn btn--accent" data-new-event>New event</button>
            </div>
          </section>
    `;

    const mainBlock = state.view === "create"
      ? createBlock
      : state.view === "questions" && questionsBlock
        ? questionsBlock
      : state.view === "bank"
        ? renderBank()
        : state.view === "event" && state.results
        ? resultsBlock
        : emptyBlock;
    const viewOpen = state.view === "create" || (state.view === "questions" && Boolean(questionsBlock)) || state.view === "bank" || (state.view === "event" && Boolean(state.results));
    // The student dialog is rebuilt below; keep where it was scrolled to.
    const oldDialog = document.getElementById("studentDialog");
    const dialogScroll = oldDialog ? oldDialog.scrollTop : 0;

    screen.innerHTML = `
      <div class="toolbar">
        <span class="muted">Signed in as <strong>${escapeHtml(state.user.email)}</strong> (${escapeHtml(state.user.role)})</span>
        <button id="logoutBtn" class="btn btn--destructive btn--sm">Log out</button>
      </div>

      <div class="dash ${viewOpen ? "dash--open" : ""}">
        <nav class="dash__side" aria-labelledby="eventsHeading">
          <section class="card card--flush">
            <div class="side-head card__pad">
              <h2 id="eventsHeading">${isAdmin() ? "Events" : "Your events"}</h2>
              <button type="button" class="btn ${state.view === "create" ? "btn--secondary" : "btn--accent"} btn--sm" data-new-event ${state.view === "create" ? `aria-current="true"` : ""}>+ New event</button>
            </div>
            <div id="eventListBody">${renderEventFilter()}${renderEventList()}</div>
          </section>
          <button type="button" class="side-link ${state.view === "bank" ? "side-link--active" : ""}" data-open-bank ${state.view === "bank" ? `aria-current="true"` : ""}>
            <span>Question bank</span>
            <span class="muted small">${state.bank ? `${state.bank.length} questions` : "Browse every question"}</span>
          </button>
        </nav>

        <div class="dash__main">
          ${viewOpen ? `<button type="button" class="dash__back btn btn--ghost btn--sm" data-back>&larr; All events</button>` : ""}
          ${mainBlock}
        </div>
      </div>
    `;

    document.getElementById("logoutBtn").addEventListener("click", () => {
      state.token = null;
      state.user = null;
      state.events = [];
      state.selectedEventId = null;
      state.view = null;
      state.bank = null;
      state.results = null;
      state.outcomesSummary = null;
      state.eventQuestions = null;
      state.openAttemptId = null;
      state.eventFilter = { scope: "all", owner: "" };
      localStorage.removeItem(TOKEN_KEY);
      renderLogin();
    });

    const createBtn = document.getElementById("createEventBtn");

    if (createBtn && state.view === "create") createBtn.addEventListener("click", () => withBusy(createBtn, async () => {
      const title = document.getElementById("title").value.trim();
      const joinCode = document.getElementById("joinCode").value.trim();
      const durationMinutes = document.getElementById("durationMinutes").value;
      const startAt = document.getElementById("startAt").value;
      const endAt = document.getElementById("endAt").value;

      // Customise only takes over while it is open. Otherwise the quick setup
      // choice decides, or the legacy question set if presets did not load.
      // basedOnPreset lets the server record which card Customise started
      // from, and whether the teacher changed it.
      const selection = advancedActive()
        ? { filter: pickerFilter(), ...(state.presets && state.quick ? { basedOnPreset: state.quick } : {}) }
        : quickActive()
          ? { preset: state.quick }
          : document.getElementById("selectionMode")
            ? { selectionMode: document.getElementById("selectionMode").value }
            : null;

      if (!selection) {
        alert("Choose the questions first.");
        return;
      }

      try {
        const created = await api("/api/events", {
          method: "POST",
          body: JSON.stringify({
            title,
            ...selection,
            joinCode,
            durationMinutes: durationMinutes ? Number(durationMinutes) : null,
            // datetime-local has no time zone; converting here uses the
            // teacher's browser zone and sends an absolute UTC time.
            startAt: startAt ? new Date(startAt).toISOString() : null,
            endAt: endAt ? new Date(endAt).toISOString() : null,
            feedbackMode: state.settings.feedbackMode,
            navigationMode: state.settings.navigationMode
          })
        });

        if (created.warning) {
          alert(created.warning);
        }

        state.pickerEdited = false;
        state.view = "event";
        state.selectedEventId = created.event.id;
        state.editingSettings = false;

        await loadDashboard();
        await loadResults(created.event.id);
      } catch (error) {
        alert(error.message);
      }
    }, "Creating\u2026"));

    if (createBtn && state.view === "questions") {
      createBtn.addEventListener("click", () => withBusy(createBtn, saveQuestions, "Saving\u2026"));
      document.getElementById("cancelQuestionsBtn").addEventListener("click", () => {
        resetPickerState();
        state.view = "event";
        renderDashboard();
      });
    }

    const editQuestionsBtn = document.getElementById("editQuestionsBtn");

    if (editQuestionsBtn) {
      editQuestionsBtn.addEventListener("click", openChangeQuestions);
    }

    Array.from(screen.querySelectorAll("[data-new-event]")).forEach(button => {
      button.addEventListener("click", openCreate);
    });

    const bankBtn = screen.querySelector("[data-open-bank]");

    if (bankBtn) {
      bankBtn.addEventListener("click", openBank);
    }

    if (state.view === "bank") {
      bindBankEvents();
    }

    const backBtn = screen.querySelector("[data-back]");

    if (backBtn) {
      backBtn.addEventListener("click", () => {
        state.view = null;
        renderDashboard();
        const heading = document.getElementById("eventsHeading");
        if (heading) heading.scrollIntoView({ block: "start" });
      });
    }

    if (state.view === "create" || (state.view === "questions" && questionsBlock)) {
      bindQuickSetupEvents();
      renderQuickSummary();
      bindAdvancedPickerEvents();
      bindAdvancedToggle();
      bindSettingsEvents();
      updateCreateButtonState();
    }

    const editSettingsBtn = document.getElementById("editSettingsBtn");

    if (editSettingsBtn) {
      editSettingsBtn.addEventListener("click", () => {
        state.editingSettings = true;
        renderDashboard();
        const title = document.getElementById("editTitle");
        if (title) {
          title.focus();
        }
      });
    }

    if (canManage) {
      bindEditSettings(resultsEvent);
    }

    const releaseBtn = document.getElementById("releaseBtn");

    if (releaseBtn) {
      releaseBtn.addEventListener("click", async () => {
        if (!confirm("Release results? Students will see which questions they got right and the correct options.")) {
          return;
        }

        await withBusy(releaseBtn, async () => {
          try {
            await api(`/api/events/${state.selectedEventId}/release`, { method: "POST" });
            await loadResults(state.selectedEventId);
          } catch (error) {
            alert(error.message);
          }
        }, "Releasing\u2026");
      });
    }

    Array.from(screen.querySelectorAll("[data-reset-attempt]")).forEach(button => {
      button.addEventListener("click", async () => {
        const attemptId = Number(button.getAttribute("data-reset-attempt"));

        if (!confirm("Reset this attempt? It stays in the record, and the student can start the test again.")) {
          return;
        }

        await withBusy(button, async () => {
          try {
            await api(`/api/events/${state.selectedEventId}/attempts/${attemptId}/reset`, { method: "POST" });
            await loadResults(state.selectedEventId);
          } catch (error) {
            alert(error.message);
          }
        }, "Resetting\u2026");
      });
    });

    Array.from(screen.querySelectorAll("[data-review-attempt]")).forEach(button => {
      button.addEventListener("click", async () => {
        const attemptId = Number(button.getAttribute("data-review-attempt"));
        const questionId = button.getAttribute("data-review-question");
        const key = button.getAttribute("data-review-key");
        const score = Number(document.getElementById(`score-${key}`).value);
        const feedback = document.getElementById(`feedback-${key}`).value;

        await withBusy(button, async () => {
          try {
            await api(`/api/events/${state.selectedEventId}/attempts/${attemptId}/answers/${encodeURIComponent(questionId)}/review`, {
              method: "POST",
              body: JSON.stringify({ score, feedback })
            });
            await loadResults(state.selectedEventId);
          } catch (error) {
            alert(error.message);
          }
        }, "Saving\u2026");
      });
    });

    bindEventListEvents();
    bindOutcomesSummaryEvents();
    bindQuestionPreviewEvents(document.getElementById("eventQuestionsSection"));
    bindSections();
    bindStudentDialog(dialogScroll);
  }

  // Opens an event in the main area. On a phone the list gives way to it.
  async function openEvent(eventId) {
    state.selectedEventId = eventId;
    state.view = "event";
    state.editingSettings = false;
    state.openAttemptId = null;
    state.openAnswerRows = new Set();

    // Show the choice straight away: mark the list row and swap the main area
    // for a skeleton, so the previous event never lingers while this loads.
    const main = screen.querySelector(".dash__main");
    const dash = screen.querySelector(".dash");

    if (main && dash) {
      dash.classList.add("dash--open");
      main.innerHTML = skeletonMainHtml();
      screen.querySelectorAll("[data-event-id]").forEach(button => {
        const active = Number(button.getAttribute("data-event-id")) === eventId;
        button.classList.toggle("event-card--active", active);

        if (active) {
          button.setAttribute("aria-current", "true");
        } else {
          button.removeAttribute("aria-current");
        }
      });
    }

    window.scrollTo({ top: 0 });
    await loadResults(eventId);
  }

  // Opens the new-event form in the main area, with a fresh preview.
  function openCreate() {
    // Change questions borrows the same picker state, so start from a clean one.
    resetPickerState();
    state.view = "create";
    state.editingSettings = false;
    renderDashboard();
    schedulePreview();
    window.scrollTo({ top: 0 });
    const title = document.getElementById("title");
    if (title) title.focus({ preventScroll: true });
  }

  // The New event screen's starting picker state: the first preset card, an
  // empty Customise, nothing edited, no preview.
  function resetPickerState() {
    state.quick = state.presets && state.presets.presets.length ? { ...state.presets.presets[0].defaults } : null;
    state.picker = { audience: "core", levels: [], outcomes: [], nodes: [], types: [], difficultyMin: "", difficultyMax: "", limit: "" };
    state.pickerEdited = false;
    state.preview = null;
    state.previewError = null;
  }

  // Opens the picker on an event's questions. The picker starts on the
  // event's current filter (and its preset card, if it came from one); Customise
  // stays closed until asked for, and a choice is required before saving.
  function openChangeQuestions() {
    const event = state.results.event;

    fillPickerFromFilter(event.filter || {});
    state.pickerEdited = true;
    state.quick = event.preset ? { id: event.preset.id, ...event.preset.options } : null;
    state.preview = null;
    state.view = "questions";
    renderDashboard();
    schedulePreview();
    window.scrollTo({ top: 0 });
  }

  async function saveQuestions() {
    const eventId = state.selectedEventId;
    const selection = advancedActive()
      ? { filter: pickerFilter(), ...(state.presets && state.quick ? { basedOnPreset: state.quick } : {}) }
      : quickActive()
        ? { preset: state.quick }
        : document.getElementById("selectionMode")
          ? { selectionMode: document.getElementById("selectionMode").value }
          : null;

    if (!selection) {
      alert("Choose the questions first.");
      return;
    }

    try {
      const changed = await api(`/api/events/${eventId}/questions`, {
        method: "PUT",
        body: JSON.stringify(selection)
      });

      if (changed.warning) {
        alert(changed.warning);
      }

      resetPickerState();
      state.view = "event";
      await loadDashboard();
      await loadResults(eventId);
    } catch (error) {
      alert(error.message);
    }
  }

  let resultsRequestId = 0;

  async function loadResults(eventId) {
    const requestId = (resultsRequestId += 1);

    try {
      const [results, outcomesSummary, questions] = await Promise.all([
        api(`/api/events/${eventId}/results`),
        api(`/api/events/${eventId}/outcomes-summary`).catch(() => null),
        api(`/api/events/${eventId}/questions`).catch(() => null)
      ]);
      // A newer click, or leaving the event view, makes this response stale.
      if (requestId !== resultsRequestId || state.selectedEventId !== eventId || state.view !== "event") {
        return;
      }

      state.results = results;
      state.outcomesSummary = outcomesSummary;
      state.eventQuestions = questions ? questions.questions : null;
      renderDashboard();
    } catch (error) {
      if (requestId !== resultsRequestId || state.selectedEventId !== eventId || state.view !== "event") {
        return;
      }

      const main = screen.querySelector(".dash__main");

      if (!main) {
        alert(error.message);
        return;
      }

      main.innerHTML = `
        <div class="notice notice--critical" role="alert">
          <p><strong>Could not load this event.</strong> ${escapeHtml(error.message)}</p>
          <div class="row mt-s">
            <button type="button" class="btn btn--secondary btn--sm" id="retryEventBtn">Retry</button>
          </div>
        </div>
      `;
      document.getElementById("retryEventBtn").addEventListener("click", () => openEvent(eventId));
    }
  }

  // Loads the picker's reference data. Failure here must not block the
  // simple create-event path, so it is caught and flagged rather than thrown.
  let pickerDataLoading = false;

  async function loadPickerData() {
    try {
      const [catalog, ontology, outcomes] = await Promise.all([
        api("/api/catalog"),
        api("/api/ontology"),
        api("/api/outcomes")
      ]);

      state.catalog = catalog;
      state.ontology = ontology;
      state.outcomes = outcomes.outcomes;
      state.catalogFailed = false;
    } catch (_error) {
      state.catalogFailed = true;
    }

    // Presets load on their own, so the cards still work if the picker data
    // fails, and the legacy question set still works if the presets fail.
    try {
      state.presets = await api("/api/presets");
      state.presetsFailed = false;

      if (!state.quick && state.presets.presets.length) {
        state.quick = { ...state.presets.presets[0].defaults };
        schedulePreview();
      }
    } catch (_error) {
      state.presets = null;
      state.presetsFailed = true;
    }
  }

  async function loadDashboard() {
    // Nothing on screen yet (first load or just signed in): show the layout
    // as a skeleton rather than an empty page while the first requests run.
    if (!screen.querySelector(".dash")) {
      screen.innerHTML = skeletonDashboardHtml();
    }

    const mePayload = await api("/api/auth/me", { method: "GET" });
    const eventsPayload = await api("/api/events", { method: "GET" });

    state.user = mePayload.user;
    state.events = eventsPayload.events;

    // With no events yet, the form is the only useful thing to show.
    if (!state.view && !state.events.length) {
      state.view = "create";
    }

    if (state.selectedEventId) {
      const stillExists = state.events.some(event => event.id === state.selectedEventId);
      if (!stillExists) {
        state.selectedEventId = null;
        state.view = state.view === "event" ? null : state.view;
        state.results = null;
        state.outcomesSummary = null;
        state.eventQuestions = null;
      }
    }

    const pickerNeeded = !state.catalog && !state.catalogFailed;

    // A first-time teacher lands straight on the form, which needs the preset
    // cards, so wait for them. Everyone else sees the dashboard now and the
    // picker data finishes in the background.
    if (pickerNeeded && state.view === "create") {
      await loadPickerData();
    }

    renderDashboard();

    if (pickerNeeded && state.view !== "create" && !pickerDataLoading) {
      pickerDataLoading = true;
      loadPickerData().finally(() => {
        pickerDataLoading = false;

        // The teacher may have opened New event before the data arrived; give
        // them the real form unless they have already started typing.
        const titleInput = document.getElementById("title");

        if (state.view === "create" && !state.pickerEdited && titleInput && !titleInput.value) {
          resetPickerState();
          renderDashboard();
          schedulePreview();
          return;
        }

        refreshAdvancedPicker();
        updateCreateButtonState();
      });
    }
  }

  async function boot() {
    await visualsReady;

    if (!state.token) {
      renderLogin();
      return;
    }

    // A reload with #q=ID goes back to the bank; the first dashboard draw
    // would clear the hash, so it is read first.
    state.bankSelected = bankHashId();
    screen.innerHTML = skeletonDashboardHtml();

    try {
      await loadDashboard();

      if (state.bankSelected) {
        await openBank();
      }
    } catch (_error) {
      state.token = null;
      localStorage.removeItem(TOKEN_KEY);
      renderLogin("Your session expired. Please sign in again.");
    }
  }

  boot();
})();
