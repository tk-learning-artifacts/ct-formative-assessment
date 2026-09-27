(function () {
  const screen = document.getElementById("screen");
  const TOKEN_KEY = "ct-quest-token";
  const PREVIEW_DEBOUNCE_MS = 300;
  // The dashboard's single-column layout; matches the query in style.css.
  const NARROW_DASH = "(max-width: 999.98px)";

  const state = {
    token: localStorage.getItem(TOKEN_KEY),
    user: null,
    events: [],
    selectedEventId: null,
    results: null,
    outcomesSummary: null,
    outcomesSort: { key: "meanPercentage", dir: "asc" },
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
    previewLoading: false
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

  async function api(path, options) {
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

  // Each AI-scored answer, with a small form to set the score and feedback.
  // A committed answer can be marked before the student submits, so under
  // "after each question" they see the mark straight away.
  function aiAnswersBlock(attempt, canManage) {
    return attempt.answers
      .filter(answer => answer.questionType === "open-response-ai")
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

    try {
      const payload = await api("/api/question-bank/preview", {
        method: "POST",
        body: JSON.stringify(body)
      });

      if (requestId !== previewRequestId) {
        return; // a newer request has already started; drop this stale one
      }

      state.preview = payload;
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
      el.innerHTML = `<p class="muted">Checking what matches&hellip;</p>`;
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

    el.innerHTML = `
      <div class="row">
        <h3>${preview.count} question${preview.count === 1 ? "" : "s"}</h3>
        <span class="muted small">${preview.totalPoints} point${preview.totalPoints === 1 ? "" : "s"}</span>
        ${aiFlag !== undefined ? `<span class="tag ${aiFlag ? "tag--accent" : ""}">${aiFlag ? "Uses AI scoring" : "No AI scoring"}</span>` : ""}
      </div>
      ${preview.count === 0 ? `<p class="notice notice--critical mt-s">No questions match. Widen the selection before you create the event.</p>` : ""}
      ${preview.warning ? `<p class="notice notice--warning mt-s">${escapeHtml(preview.warning)}</p>` : ""}
      <dl class="preview-facts">
        <dt>Levels</dt><dd>${counts(preview.byLevel)}</dd>
        <dt>Types</dt><dd>${counts(preview.byType)}</dd>
        <dt>Audiences</dt><dd>${counts(preview.byAudience)}</dd>
      </dl>
      ${preview.questions && preview.questions.length
        ? `<ol class="preview-list">${preview.questions.map(q => `<li>${escapeHtml(q.title)} <span class="muted">${escapeHtml(q.level)} · ${escapeHtml(q.type)}</span></li>`).join("")}</ol>`
        : ""
      }
    `;
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

    const blocked = (advancedActive() || quickActive()) && (!state.preview || state.preview.count === 0 || state.previewError);
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
      el.innerHTML = `<p class="muted small">Checking what matches&hellip;</p>`;
      return;
    }

    const preview = state.preview;
    el.innerHTML = `
      <div class="row small">
        <span>${preview.count} question${preview.count === 1 ? "" : "s"}, ${preview.totalPoints} point${preview.totalPoints === 1 ? "" : "s"}</span>
        <span class="tag ${preview.aiRequired ? "tag--accent" : ""}">${preview.aiRequired ? "Uses AI scoring" : "No AI scoring"}</span>
      </div>
      ${preview.count === 0 ? `<p class="notice notice--critical mt-s">No questions match. Pick another setting before you create the event.</p>` : ""}
      ${preview.warning ? `<p class="notice notice--warning mt-s">${escapeHtml(preview.warning)}</p>` : ""}
    `;
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

  function renderOutcomesSummaryBlock() {
    if (!state.outcomesSummary) {
      return "";
    }

    const outcomeRows = sortRows(state.outcomesSummary.outcomes, state.outcomesSort.key, state.outcomesSort.dir);
    const nodeRows = sortRows(state.outcomesSummary.ontologyNodes, state.outcomesSort.key, state.outcomesSort.dir);

    return `
      <section class="card">
        <div class="section-heading">
          <h2>Results by outcome</h2>
          <p class="small">Averages leave out AI-scored answers that are not marked yet. Click a column to sort.</p>
        </div>

        ${outcomeRows.length
          ? outcomesTable("Learning outcomes", "Outcome", outcomeRows, row => renderOutcomeRow(row, row.statement, false))
          : `<p class="muted">No learning outcome has submissions yet.</p>`
        }

        ${nodeRows.length
          ? outcomesTable("CT capabilities", "Capability", nodeRows, row => renderOutcomeRow(row, row.label, !row.topLevel))
          : `<p class="muted mt-m">No CT capability has submissions yet.</p>`
        }
      </section>
    `;
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
    end_at: "Deadline"
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

    return `
      <details class="history">
        <summary>Settings history (${changes.length} change${changes.length === 1 ? "" : "s"})</summary>
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
      </details>
    `;
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
        <p class="muted small mt-s">The questions can't be changed, because students' answers refer to them. For a different set, create a new event.</p>
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

      try {
        await api(`/api/events/${event.id}`, { method: "PATCH", body: JSON.stringify(body) });
        state.editingSettings = false;
        const eventsPayload = await api("/api/events", { method: "GET" });
        state.events = eventsPayload.events;
        await loadResults(event.id);
      } catch (error) {
        alert(error.message);
      }
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

  function renderEventList() {
    const events = visibleEvents();
    const cards = events.map(event => `
      <li>
        <button class="event-card ${state.selectedEventId === event.id ? "event-card--active" : ""}" data-event-id="${event.id}" ${state.selectedEventId === event.id ? `aria-current="true"` : ""}>
          <span class="event-card__title">${escapeHtml(event.title)}</span>
          <span class="tag tag--code">${escapeHtml(event.join_code)}</span>
          <span class="event-card__meta">
            ${isAdmin() ? `<span class="event-card__owner">${event.owned ? "Yours" : escapeHtml(event.owner_email || "Unknown teacher")}</span>` : ""}
            <span>${escapeHtml(event.filter_summary || event.selection_mode)}</span>
            <span>${escapeHtml(presetLine(event))}</span>
            <span>${event.duration_minutes ? `${event.duration_minutes} min` : "No time limit"}</span>
            <span>${event.attempt_count} attempt${event.attempt_count === 1 ? "" : "s"}</span>
            <span>${escapeHtml(FEEDBACK_LABELS[event.feedback_mode] || FEEDBACK_LABELS.release)}</span>
            <span>${escapeHtml(NAVIGATION_LABELS[event.navigation_mode] || NAVIGATION_LABELS.free)}</span>
          </span>
        </button>
      </li>
    `).join("");

    if (cards) {
      return `<ul class="event-list">${cards}</ul>`;
    }

    return state.events.length
      ? `<p class="muted card__pad">No events match this filter.</p>`
      : `<p class="muted card__pad">No events yet. Create one with the form above.</p>`;
  }

  function bindEventListEvents() {
    Array.from(screen.querySelectorAll("[data-event-id]")).forEach(button => {
      button.addEventListener("click", async () => {
        state.selectedEventId = Number(button.getAttribute("data-event-id"));
        state.editingSettings = false;
        await loadResults(state.selectedEventId);

        // In the single-column layout the results now sit above the form
        // (style.css), so bring them into view from the event list below.
        if (window.matchMedia(NARROW_DASH).matches) {
          const main = screen.querySelector(".dash__main");
          if (main) main.scrollIntoView({ block: "start" });
        }
      });
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

  // ---------- Dashboard ----------

  function renderDashboard() {
    const attemptStatus = attempt => attempt.reset_at
      ? `<span class="tag status status--neutral">Reset</span>`
      : attempt.status === "submitted"
        ? `<span class="tag status status--positive">Submitted</span>`
        : `<span class="tag status status--pending">${escapeHtml(attempt.status === "started" ? "In progress" : attempt.status)}</span>`;

    const resultsEvent = state.results && state.results.event;
    // An admin reading another teacher's event sees everything but cannot
    // change it (ADR 0004); the server refuses those changes with 403 too.
    const canManage = Boolean(resultsEvent && resultsEvent.can_manage);
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
            </div>
          </div>
          <p class="muted small results-facts">
            ${escapeHtml(presetLine(resultsEvent))} · ${escapeHtml(resultsEvent.filter_summary || resultsEvent.selection_mode)} ·
            ${resultsEvent.duration_minutes ? `${resultsEvent.duration_minutes} min` : "No time limit"}${resultsEvent.end_at ? ` · Deadline ${escapeHtml(formatTime(resultsEvent.end_at))}` : ""}
          </p>
          ${canManage ? "" : `<p class="notice read-only">Read only: this is ${escapeHtml(resultsEvent.owner_email || "another teacher")}'s event. Only they can reset attempts, release results, edit settings or mark answers.</p>`}
          ${canManage && state.editingSettings ? renderEditSettings(resultsEvent) : ""}
          ${renderSettingsHistory(state.results.settingChanges)}
          ${state.results.attempts.length
            ? `<ul class="attempts">${state.results.attempts.map(attempt => `
              <li class="attempt">
                <div class="attempt__row">
                  <span class="attempt__who"><strong>${escapeHtml(attempt.student_name)}</strong> <span class="muted small">${escapeHtml(attempt.student_group)}</span></span>
                  <span class="row">
                    ${attemptStatus(attempt)}
                    ${attempt.late ? `<span class="tag status status--warning">Late</span>` : ""}
                    <span class="muted small">${attempt.submitted_at ? formatTime(attempt.submitted_at) : "Not submitted"}</span>
                  </span>
                  <span class="attempt__score">${attempt.max_score === null ? "&ndash;" : `${attempt.score ?? 0}/${attempt.max_score}`}</span>
                  ${attempt.reset_at || !canManage ? "<span></span>" : `<button class="btn btn--destructive btn--sm" data-reset-attempt="${attempt.id}" aria-label="Reset attempt for ${escapeHtml(attempt.student_name)}">Reset</button>`}
                </div>
                ${aiAnswersBlock(attempt, canManage)}
              </li>
            `).join("")}</ul>`
            : `<p class="muted">No submissions yet.</p>`
          }
        </section>

        ${renderOutcomesSummaryBlock()}
      `
      : `
        <section class="card card--raised">
          <div class="section-heading">
            <h2>Results</h2>
            <p>Pick an event to see its submissions.</p>
          </div>
        </section>
      `;

    screen.innerHTML = `
      <div class="toolbar">
        <span class="muted">Signed in as <strong>${escapeHtml(state.user.email)}</strong> (${escapeHtml(state.user.role)})</span>
        <button id="logoutBtn" class="btn btn--destructive btn--sm">Log out</button>
      </div>

      <div class="dash">
        <div class="dash__side">
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

          <section class="card card--flush" aria-labelledby="eventsHeading">
            <div class="section-heading card__pad">
              <h2 id="eventsHeading">${isAdmin() ? "Events" : "Your events"}</h2>
            </div>
            <div id="eventListBody">${renderEventFilter()}${renderEventList()}</div>
          </section>
        </div>

        <div class="dash__main">
          ${resultsBlock}
        </div>
      </div>
    `;

    document.getElementById("logoutBtn").addEventListener("click", () => {
      state.token = null;
      state.user = null;
      state.events = [];
      state.selectedEventId = null;
      state.results = null;
      state.outcomesSummary = null;
      state.eventFilter = { scope: "all", owner: "" };
      localStorage.removeItem(TOKEN_KEY);
      renderLogin();
    });

    document.getElementById("createEventBtn").addEventListener("click", async () => {
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
          : { selectionMode: document.getElementById("selectionMode").value };

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

        await loadDashboard();
      } catch (error) {
        alert(error.message);
      }
    });

    bindQuickSetupEvents();
    renderQuickSummary();
    bindAdvancedPickerEvents();
    bindAdvancedToggle();
    bindSettingsEvents();
    updateCreateButtonState();

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

        try {
          await api(`/api/events/${state.selectedEventId}/release`, { method: "POST" });
          await loadResults(state.selectedEventId);
        } catch (error) {
          alert(error.message);
        }
      });
    }

    Array.from(screen.querySelectorAll("[data-reset-attempt]")).forEach(button => {
      button.addEventListener("click", async () => {
        const attemptId = Number(button.getAttribute("data-reset-attempt"));

        if (!confirm("Reset this attempt? It stays in the record, and the student can start the test again.")) {
          return;
        }

        try {
          await api(`/api/events/${state.selectedEventId}/attempts/${attemptId}/reset`, { method: "POST" });
          await loadResults(state.selectedEventId);
        } catch (error) {
          alert(error.message);
        }
      });
    });

    Array.from(screen.querySelectorAll("[data-review-attempt]")).forEach(button => {
      button.addEventListener("click", async () => {
        const attemptId = Number(button.getAttribute("data-review-attempt"));
        const questionId = button.getAttribute("data-review-question");
        const key = button.getAttribute("data-review-key");
        const score = Number(document.getElementById(`score-${key}`).value);
        const feedback = document.getElementById(`feedback-${key}`).value;

        try {
          await api(`/api/events/${state.selectedEventId}/attempts/${attemptId}/answers/${encodeURIComponent(questionId)}/review`, {
            method: "POST",
            body: JSON.stringify({ score, feedback })
          });
          await loadResults(state.selectedEventId);
        } catch (error) {
          alert(error.message);
        }
      });
    });

    bindEventListEvents();
    bindOutcomesSummaryEvents();
  }

  async function loadResults(eventId) {
    try {
      const [results, outcomesSummary] = await Promise.all([
        api(`/api/events/${eventId}/results`),
        api(`/api/events/${eventId}/outcomes-summary`).catch(() => null)
      ]);
      state.results = results;
      state.outcomesSummary = outcomesSummary;
      renderDashboard();
    } catch (error) {
      alert(error.message);
    }
  }

  // Loads the picker's reference data. Failure here must not block the
  // simple create-event path, so it is caught and flagged rather than thrown.
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
    const mePayload = await api("/api/auth/me", { method: "GET" });
    const eventsPayload = await api("/api/events", { method: "GET" });

    state.user = mePayload.user;
    state.events = eventsPayload.events;

    if (state.selectedEventId) {
      const stillExists = state.events.some(event => event.id === state.selectedEventId);
      if (!stillExists) {
        state.selectedEventId = null;
        state.results = null;
        state.outcomesSummary = null;
      }
    }

    if (!state.catalog && !state.catalogFailed) {
      await loadPickerData();
    }

    renderDashboard();
  }

  async function boot() {
    if (!state.token) {
      renderLogin();
      return;
    }

    try {
      await loadDashboard();
    } catch (_error) {
      state.token = null;
      localStorage.removeItem(TOKEN_KEY);
      renderLogin("Your session expired. Please sign in again.");
    }
  }

  boot();
})();
