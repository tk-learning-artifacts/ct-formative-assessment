(function () {
  const screen = document.getElementById("screen");
  const themeToggle = document.getElementById("themeToggle");
  const root = document.documentElement;
  const THEME_KEY = "ct-quest-theme";
  const TOKEN_KEY = "ct-quest-token";
  const PREVIEW_DEBOUNCE_MS = 300;

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
    // The advanced picker's own selections, kept across re-renders.
    picker: {
      audience: "core",
      levels: [],
      outcomes: [],
      nodes: [],
      types: [],
      difficultyMin: "",
      difficultyMax: ""
    },
    preview: null,
    previewError: null,
    previewLoading: false
  };

  let previewTimer = null;
  let previewRequestId = 0;

  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function updateThemeButton(theme) {
    const pressed = theme === "dark";
    themeToggle.setAttribute("aria-pressed", pressed ? "true" : "false");
    themeToggle.setAttribute("aria-label", pressed ? "Switch to light mode" : "Switch to dark mode");
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    updateThemeButton(theme);
  }

  function initTheme() {
    applyTheme(getPreferredTheme());

    themeToggle.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  }

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

  // Status line for an AI-scored answer, for the teacher only.
  function aiStatusText(answer) {
    const detail = answer.detail || {};

    if (detail.review) {
      return `Marked by you: ${detail.review.score}/${answer.maxPoints}`;
    }

    if (answer.scoreStatus === "pending") {
      return "Being marked by AI";
    }

    if (answer.scoreStatus === "needs-review") {
      return `Needs your mark: ${AI_REASONS[detail.reason] || "AI could not score it"}`;
    }

    if (detail.ai === "scored") {
      return `AI scored ${answer.earnedPoints}/${answer.maxPoints} (criterion "${detail.criterionId}", ${detail.feedbackCode})`;
    }

    return answer.response ? `Scored ${answer.earnedPoints}/${answer.maxPoints}` : "No answer";
  }

  // Each AI-scored answer, with a small form to set the score and feedback.
  function aiAnswersBlock(attempt) {
    return attempt.answers
      .filter(answer => answer.questionType === "open-response-ai")
      .map(answer => {
        const detail = answer.detail || {};
        const aiFeedback = detail.ai === "scored" && detail.feedback ? detail.feedback : "";
        const reviewFeedback = detail.review && detail.review.feedback ? detail.review.feedback : "";
        const key = escapeHtml(`${attempt.id}-${answer.questionId}`);

        return `
          <div class="ai-review">
            <strong>${escapeHtml(answer.questionId)}</strong>
            <span class="${answer.scoreStatus === "scored" ? "" : "bad"}">${escapeHtml(aiStatusText(answer))}</span>
            <p class="ai-review__answer">${escapeHtml(answer.response && answer.response.text ? answer.response.text : "No answer")}</p>
            ${aiFeedback ? `<p class="muted">AI feedback: ${escapeHtml(aiFeedback)}</p>` : ""}
            ${attempt.status === "submitted" ? `
              <div class="row" style="margin-top:8px">
                <label for="score-${key}">Score</label>
                <input id="score-${key}" type="number" min="0" max="${answer.maxPoints}" step="1" value="${answer.earnedPoints}" />
                <span>/ ${answer.maxPoints}</span>
              </div>
              <label for="feedback-${key}">Feedback for the student (optional)</label>
              <textarea id="feedback-${key}" maxlength="500">${escapeHtml(reviewFeedback)}</textarea>
              <div class="nav">
                <button class="secondary" data-review-attempt="${attempt.id}" data-review-question="${escapeHtml(answer.questionId)}" data-review-key="${key}">Save mark</button>
              </div>
            ` : ""}
          </div>
        `;
      }).join("");
  }

  function renderLogin(errorMessage) {
    screen.innerHTML = `
      <section class="card start-layout">
        <div class="panel">
          <p class="panel-label">Teacher Login</p>
          <h2>Access Your Event Dashboard</h2>
          <p class="muted">Sign in with your teacher account to create events and view results.</p>

          <div class="stack" style="margin-top:20px">
            <div>
              <label for="email">Email</label>
              <input id="email" type="email" autocomplete="username" />
            </div>

            <div>
              <label for="password">Password</label>
              <input id="password" type="password" autocomplete="current-password" />
            </div>
          </div>

          ${errorMessage ? `<p class="notice notice--danger">${escapeHtml(errorMessage)}</p>` : ""}

          <div class="nav">
            <span class="pill">Teacher access only</span>
            <button class="primary" id="loginBtn">Sign in</button>
          </div>
        </div>

        <div class="panel panel--accent">
          <p class="panel-label">What You Can Do</p>
          <h2>Launch Events Fast</h2>
          <ul class="feature-list">
            <li>Create a new event with a unique join code.</li>
            <li>Choose a level track or release all questions.</li>
            <li>Monitor submissions and scores from the same page.</li>
          </ul>
        </div>
      </section>
    `;

    document.getElementById("loginBtn").addEventListener("click", async () => {
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

    if (min || max) {
      filter.difficulty = {};
      if (min) {
        filter.difficulty.min = min;
      }
      if (max) {
        filter.difficulty.max = max;
      }
    }

    return filter;
  }

  function schedulePreview() {
    if (previewTimer) {
      clearTimeout(previewTimer);
    }

    state.previewLoading = true;
    previewTimer = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS);
  }

  async function runPreview() {
    const requestId = (previewRequestId += 1);
    const filter = pickerFilter();

    try {
      const payload = await api("/api/question-bank/preview", {
        method: "POST",
        body: JSON.stringify({ filter })
      });

      if (requestId !== previewRequestId) {
        return; // a newer request has already started; drop this stale one
      }

      state.preview = payload;
      state.previewError = null;
    } catch (error) {
      if (requestId !== previewRequestId) {
        return;
      }

      state.preview = null;
      state.previewError = error.message;
    }

    state.previewLoading = false;
    renderPreviewPanel();
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
      el.innerHTML = `<p class="notice notice--danger" style="margin-top:0">${escapeHtml(state.previewError)}</p>`;
      return;
    }

    if (!state.preview) {
      el.innerHTML = `<p class="muted">Choose what to test above to see a live preview.</p>`;
      return;
    }

    const preview = state.preview;
    const byLevel = Object.entries(preview.byLevel || {}).map(([level, count]) => `${escapeHtml(level)}: ${count}`).join(", ") || "&mdash;";
    const byType = Object.entries(preview.byType || {}).map(([type, count]) => `${escapeHtml(type)}: ${count}`).join(", ") || "&mdash;";
    const byAudience = Object.entries(preview.byAudience || {}).map(([audience, count]) => `${escapeHtml(audience)}: ${count}`).join(", ") || "&mdash;";
    // aiRequired: some matched question is AI-scored. warning: AI is off, so
    // those answers will wait for the teacher to mark them.
    const aiFlag = preview.aiRequired;

    el.innerHTML = `
      ${preview.count === 0 ? `<p class="notice notice--danger" style="margin-top:0">No questions match this selection. Widen it before creating the event.</p>` : ""}
      <div class="row" style="margin-top:0">
        <span class="pill">${preview.count} question${preview.count === 1 ? "" : "s"}</span>
        <span class="pill">${preview.totalPoints} point${preview.totalPoints === 1 ? "" : "s"}</span>
        ${aiFlag !== undefined ? `<span class="pill">${aiFlag ? "Uses AI scoring" : "No AI scoring"}</span>` : ""}
      </div>
      ${preview.warning ? `<p class="notice">${escapeHtml(preview.warning)}</p>` : ""}
      <p class="muted">By level: ${byLevel}</p>
      <p class="muted">By type: ${byType}</p>
      <p class="muted">By audience: ${byAudience}</p>
      ${preview.questions && preview.questions.length
        ? `<ul class="rule-list" style="margin-top:12px">${preview.questions.map(q => `<li>${escapeHtml(q.title)} <span class="muted" style="margin:0">(${escapeHtml(q.level)}, ${escapeHtml(q.type)})</span></li>`).join("")}</ul>`
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

  function updateCreateButtonState() {
    const btn = document.getElementById("createEventBtn");
    if (!btn) {
      return;
    }

    const blocked = advancedActive() && (!state.preview || state.preview.count === 0 || state.previewError);
    btn.disabled = blocked;
  }

  // ---------- Advanced picker: markup ----------

  function renderLevelCheckboxes() {
    const levels = audienceLevels(state.picker.audience);
    return levels.map(levelId => {
      const level = state.catalog.levels.find(item => item.id === levelId) || { id: levelId, label: levelId };
      const checked = state.picker.levels.includes(levelId);
      return `
        <label class="row" style="font-weight:700">
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
      return `<p class="muted" style="margin-top:0">No learning outcomes match this audience and level yet.</p>`;
    }

    const groups = new Map();

    visible.forEach(outcome => {
      const groupId = outcome.nodes[0] || "ungrouped";
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId).push(outcome);
    });

    return Array.from(groups.entries()).map(([nodeId, outcomes]) => {
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
                <span>${escapeHtml(outcome.statement)} <span class="muted" style="margin:0">(${outcome.questionCount} question${outcome.questionCount === 1 ? "" : "s"})</span></span>
              </label>
            `;
          }).join("")}
        </fieldset>
      `;
    }).join("");
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
          <span class="muted tree-count">${count} question${count === 1 ? "" : "s"}</span>
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
        <label class="row" for="${inputId}" style="font-weight:700 ${active ? "" : "opacity:0.6"}">
          <input type="checkbox" id="${inputId}" data-picker-type="${escapeHtml(type.type)}" ${checked ? "checked" : ""} ${active ? "" : "disabled"} />
          ${escapeHtml(type.label)} ${active ? "" : `<span class="pill">coming soon</span>`}
        </label>
      `;
    }).join("");
  }

  function renderAdvancedPicker() {
    if (state.catalogFailed) {
      return `<p class="muted">The question picker could not load. The simple options above still work.</p>`;
    }

    if (!state.catalog || !state.ontology || !state.outcomes) {
      return `<p class="muted">Loading the question picker&hellip;</p>`;
    }

    return `
      <div class="stack" style="margin-top:14px">
        <div>
          <p class="panel-label" style="margin-bottom:6px">Audience</p>
          <div class="row">
            ${state.catalog.audiences.map(audience => `
              <label class="row" style="font-weight:700">
                <input type="radio" name="pickerAudience" value="${escapeHtml(audience.id)}" ${state.picker.audience === audience.id ? "checked" : ""} />
                ${escapeHtml(audience.label)}
              </label>
            `).join("")}
          </div>
        </div>

        <div>
          <p class="panel-label" style="margin-bottom:6px">Levels</p>
          <div class="row" id="pickerLevels">${renderLevelCheckboxes()}</div>
          <p class="muted" style="margin-top:6px">No levels checked means every level this audience offers.</p>
        </div>

        <div>
          <p class="panel-label" style="margin-bottom:6px">Learning outcomes</p>
          <div id="pickerOutcomes">${renderOutcomeGroups()}</div>
        </div>

        <div>
          <p class="panel-label" style="margin-bottom:6px">Capabilities (CT ontology)</p>
          <div class="tree" id="pickerTree">${renderOntologyTree()}</div>
        </div>

        <div>
          <p class="panel-label" style="margin-bottom:6px">Question types</p>
          <div class="row" id="pickerTypes">${renderTypeCheckboxes()}</div>
          <p class="muted" style="margin-top:6px">No types checked means every type except AI-scored ones, which are only included when checked.</p>
        </div>

        <div class="row">
          <div>
            <label for="difficultyMin">Difficulty min</label>
            <input id="difficultyMin" type="number" min="1" max="5" value="${escapeHtml(state.picker.difficultyMin)}" style="width:6rem" />
          </div>
          <div>
            <label for="difficultyMax">Difficulty max</label>
            <input id="difficultyMax" type="number" min="1" max="5" value="${escapeHtml(state.picker.difficultyMax)}" style="width:6rem" />
          </div>
        </div>

        <div class="prompt-card" id="previewPanel" style="padding:16px"></div>
      </div>
    `;
  }

  function bindAdvancedPickerEvents() {
    const container = document.getElementById("advancedPicker");
    if (!container || state.catalogFailed || !state.catalog) {
      return;
    }

    function onPickerChange() {
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

    container.addEventListener("toggle", () => {
      updateCreateButtonState();
      if (advancedIsOpen() && !state.preview && !state.previewLoading) {
        schedulePreview();
      }
    });

    renderPreviewPanel();
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

  function outcomesSummaryHeader(label, key) {
    const active = state.outcomesSort.key === key;
    const arrow = active ? (state.outcomesSort.dir === "asc" ? "&uarr;" : "&darr;") : "";
    return `<button type="button" class="secondary" data-sort-key="${key}" style="padding:8px 12px">${escapeHtml(label)} ${arrow}</button>`;
  }

  function renderOutcomeRow(row, labelText) {
    if (!row.submittedAttempts) {
      return `
        <li class="result-row">
          <span>${escapeHtml(labelText)}</span>
          <span class="muted" style="margin:0">No submissions yet</span>
        </li>
      `;
    }

    const lateNote = row.lateAttempts ? ` <span class="pill">${row.lateAttempts} late</span>` : "";
    // AI-scored answers still waiting for a mark are left out of the average.
    const unmarkedNote = row.unmarkedAnswers ? ` <span class="pill">${row.unmarkedAnswers} not marked yet</span>` : "";
    return `
      <li class="result-row">
        <span>${escapeHtml(labelText)}</span>
        <span class="row" style="gap:16px">
          <span>${row.submittedAttempts} student${row.submittedAttempts === 1 ? "" : "s"}</span>
          ${row.meanPercentage === null
            ? `<span class="muted" style="margin:0">No marked answers yet</span>`
            : `<span class="${row.meanPercentage < 50 ? "bad" : "good"}">${row.meanPercentage}% average</span>`}
          <span class="${row.belowHalfCount ? "bad" : "muted"}" style="margin:0">${row.belowHalfCount} below 50%</span>
          ${lateNote}${unmarkedNote}
        </span>
      </li>
    `;
  }

  function renderOutcomesSummaryBlock() {
    if (!state.outcomesSummary) {
      return "";
    }

    const outcomeRows = sortRows(state.outcomesSummary.outcomes, state.outcomesSort.key, state.outcomesSort.dir);
    const nodeRows = sortRows(state.outcomesSummary.ontologyNodes, state.outcomesSort.key, state.outcomesSort.dir);

    return `
      <div class="results-breakdown" style="margin-top:18px">
        <p class="panel-label">Per-outcome results</p>
        <div class="row" style="margin-top:6px">
          ${outcomesSummaryHeader("Students", "submittedAttempts")}
          ${outcomesSummaryHeader("Average", "meanPercentage")}
          ${outcomesSummaryHeader("Below 50%", "belowHalfCount")}
        </div>

        <p class="muted" style="margin-top:14px">Learning outcomes</p>
        ${outcomeRows.length
          ? `<ul class="event-grid" style="list-style:none;padding:0;margin:8px 0 0">${outcomeRows.map(row => renderOutcomeRow(row, row.statement)).join("")}</ul>`
          : `<p class="muted">No learning outcome has submissions yet.</p>`
        }

        <p class="muted" style="margin-top:18px">CT capabilities</p>
        ${nodeRows.length
          ? `<ul class="event-grid" style="list-style:none;padding:0;margin:8px 0 0">${nodeRows.map(row => renderOutcomeRow(row, `${row.topLevel ? "" : "  "}${row.label}`)).join("")}</ul>`
          : `<p class="muted">No CT capability has submissions yet.</p>`
        }
      </div>
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

  // ---------- Dashboard ----------

  function renderDashboard() {
    const eventCards = state.events.map(event => `
      <button class="event-card ${state.selectedEventId === event.id ? "event-card--active" : ""}" data-event-id="${event.id}">
        <div class="event-card__top">
          <strong>${escapeHtml(event.title)}</strong>
          <span class="pill">${escapeHtml(event.join_code)}</span>
        </div>
        <div class="event-card__meta">
          <span>${escapeHtml(event.filter_summary || event.selection_mode)}</span>
          <span>${event.duration_minutes ? `${event.duration_minutes} min` : "No timer"}</span>
          <span>${event.attempt_count} attempts</span>
        </div>
      </button>
    `).join("");

    const resultsEvent = state.results && state.results.event;
    const resultsBlock = state.results
      ? `
        <div class="results-breakdown" style="margin-top:18px">
          <p class="panel-label">Submissions</p>
          <h3>${escapeHtml(resultsEvent.title)} (${escapeHtml(resultsEvent.join_code)})</h3>
          <div class="row" style="margin-top:10px">
            <span class="pill">${resultsEvent.breakdown_released ? "Breakdown visible to students" : "Breakdown hidden from students"}</span>
            ${resultsEvent.results_released_at ? "" : `<button id="releaseBtn" class="secondary">Release results</button>`}
          </div>
          <div class="stack" style="margin-top:14px">
            ${state.results.attempts.length
              ? state.results.attempts.map(attempt => `
                <div class="attempt-card">
                  <div class="attempt-card__top">
                    <strong>${escapeHtml(attempt.student_name)}</strong>
                    <span class="${attempt.score === attempt.max_score ? "good" : "bad"}">${attempt.score ?? 0}/${attempt.max_score ?? 0}</span>
                  </div>
                  <div class="event-card__meta">
                    <span>${escapeHtml(attempt.student_group)}</span>
                    <span>${escapeHtml(attempt.reset_at ? "reset" : attempt.status)}</span>
                    ${attempt.late ? `<span class="bad">late</span>` : ""}
                    <span>${attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString() : "Not submitted"}</span>
                    ${attempt.reset_at ? "" : `<button class="secondary" data-reset-attempt="${attempt.id}">Reset</button>`}
                  </div>
                  ${aiAnswersBlock(attempt)}
                </div>
              `).join("")
              : `<p class="muted">No submissions yet for this event.</p>`
            }
          </div>
        </div>

        ${renderOutcomesSummaryBlock()}
      `
      : `
        <div class="results-breakdown" style="margin-top:18px">
          <p class="panel-label">Submissions</p>
          <h3>Choose an event</h3>
          <p class="muted">Select one of your events to load student submissions.</p>
        </div>
      `;

    screen.innerHTML = `
      <section class="card question-card">
        <div class="question-top">
          <div class="question-banner">
            <p class="panel-label">Signed In</p>
            <h2>${escapeHtml(state.user.email)}</h2>
            <p class="muted">Create events with join codes and keep each cohort on the right paper.</p>
            <div class="row" style="margin-top:14px">
              <span class="pill">${escapeHtml(state.user.role)}</span>
              <button id="logoutBtn" class="secondary">Log out</button>
            </div>
          </div>

          <div class="progress-panel">
            <p class="panel-label">Create Event</p>
            <div class="stack" style="margin-top:10px">
              <div>
                <label for="title">Event title</label>
                <input id="title" type="text" placeholder="e.g. P6 Mock Round 1" />
              </div>
              <div>
                <label for="selectionMode">Question set</label>
                <select id="selectionMode">
                  <optgroup label="CT Quest core">
                    <option value="ALL">All levels</option>
                    <option value="P5">P5 only</option>
                    <option value="P6">P6 only</option>
                    <option value="S1">S1 only</option>
                    <option value="S2">S2 only</option>
                  </optgroup>
                  <optgroup label="RGSynapse (sample questions)">
                    <option value="RGS:S1,S2">RGSynapse Sec 1 and Sec 2</option>
                    <option value="RGS:S1">RGSynapse Sec 1</option>
                    <option value="RGS:S2">RGSynapse Sec 2</option>
                  </optgroup>
                </select>
              </div>
              <div>
                <label for="joinCode">Join code (optional)</label>
                <input id="joinCode" type="text" placeholder="Auto-generate if blank" />
              </div>
              <div>
                <label for="durationMinutes">Time limit in minutes (optional)</label>
                <input id="durationMinutes" type="number" min="1" placeholder="e.g. 45" />
              </div>
              <div>
                <label for="startAt">Open time (optional)</label>
                <input id="startAt" type="datetime-local" />
              </div>
              <div>
                <label for="endAt">Deadline (optional)</label>
                <input id="endAt" type="datetime-local" />
              </div>

              <details id="advancedPicker">
                <summary>Advanced: choose what to test</summary>
                <div id="advancedPickerBody">${renderAdvancedPicker()}</div>
              </details>
            </div>

            <div class="nav">
              <span class="pill">Join code ready instantly</span>
              <button id="createEventBtn" class="primary">Create event</button>
            </div>
          </div>
        </div>

        <div class="results-summary">
          <p class="panel-label">Your Events</p>
          <h3>Live Join Codes</h3>
          <div class="event-grid" style="margin-top:14px">
            ${eventCards || `<p class="muted">No events yet. Create your first one above.</p>`}
          </div>
        </div>

        ${resultsBlock}
      </section>
    `;

    document.getElementById("logoutBtn").addEventListener("click", () => {
      state.token = null;
      state.user = null;
      state.events = [];
      state.selectedEventId = null;
      state.results = null;
      state.outcomesSummary = null;
      localStorage.removeItem(TOKEN_KEY);
      renderLogin();
    });

    document.getElementById("createEventBtn").addEventListener("click", async () => {
      const title = document.getElementById("title").value.trim();
      const selectionMode = document.getElementById("selectionMode").value;
      const joinCode = document.getElementById("joinCode").value.trim();
      const durationMinutes = document.getElementById("durationMinutes").value;
      const startAt = document.getElementById("startAt").value;
      const endAt = document.getElementById("endAt").value;

      // The advanced section only takes over when the teacher has it open;
      // collapsed (the default) always keeps today's simple selectionMode path.
      const selection = advancedActive()
        ? { filter: pickerFilter() }
        : { selectionMode };

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
            endAt: endAt ? new Date(endAt).toISOString() : null
          })
        });

        if (created.warning) {
          alert(created.warning);
        }

        await loadDashboard();
      } catch (error) {
        alert(error.message);
      }
    });

    bindAdvancedPickerEvents();
    updateCreateButtonState();

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

    Array.from(screen.querySelectorAll("[data-event-id]")).forEach(button => {
      button.addEventListener("click", async () => {
        state.selectedEventId = Number(button.getAttribute("data-event-id"));
        await loadResults(state.selectedEventId);
      });
    });

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
    initTheme();

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
