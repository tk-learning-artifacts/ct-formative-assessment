(function () {
  const screen = document.getElementById("screen");
  const themeToggle = document.getElementById("themeToggle");
  const root = document.documentElement;
  const THEME_KEY = "ct-quest-theme";

  let ACTIVE_BANK = [];

  const state = {
    name: "",
    group: "",
    joinCode: "",
    eventTitle: "",
    durationMinutes: null,
    attemptId: null,
    attemptToken: null,
    deadlineMs: null,
    timerId: null,
    submitting: false,
    i: 0,
    answers: {},
    startedAt: null
  };

  function answeredCount() {
    return Object.keys(state.answers).length;
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function b64EncodeUnicode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach(byte => (bin += String.fromCharCode(byte)));
    return btoa(bin);
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

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
    // Merge rather than spread headers, so a caller's extra header (such as
    // the attempt token) does not drop Content-Type and empty the JSON body.
    const headers = new Headers(options && options.headers ? options.headers : {});
    headers.set("Content-Type", "application/json");

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

  function formatRemaining(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function updateTimerPill() {
    const pill = document.getElementById("timerPill");

    if (!pill || state.deadlineMs === null) {
      return;
    }

    const remaining = state.deadlineMs - Date.now();
    pill.textContent = `${formatRemaining(remaining)} left`;
    pill.classList.toggle("pill--timer-low", remaining <= 60 * 1000);
  }

  // The server sends its own clock with the deadline, so a student whose
  // device clock is wrong still gets the right amount of time.
  function startTimer(deadlineAt, serverNow) {
    stopTimer();

    if (!deadlineAt) {
      state.deadlineMs = null;
      return;
    }

    const skew = serverNow ? Date.now() - Date.parse(serverNow) : 0;
    state.deadlineMs = Date.parse(deadlineAt) + skew;

    state.timerId = setInterval(() => {
      updateTimerPill();

      if (Date.now() >= state.deadlineMs) {
        stopTimer();
        submitAttempt({ auto: true });
      }
    }, 1000);
  }

  function captureCurrentSelection() {
    const q = ACTIVE_BANK[state.i];
    const selected = screen.querySelector('input[name="opt"]:checked');

    if (q && selected) {
      state.answers[q.id] = Number(selected.value);
    }
  }

  async function submitAttempt({ auto = false } = {}) {
    if (state.submitting || !state.attemptId) {
      return;
    }

    captureCurrentSelection();
    state.submitting = true;

    try {
      const payload = await api(`/api/attempts/${state.attemptId}/submit`, {
        method: "POST",
        headers: { "X-Attempt-Token": state.attemptToken },
        body: JSON.stringify({ answers: state.answers })
      });

      stopTimer();
      renderResults(payload, { auto });
    } catch (error) {
      state.submitting = false;
      alert(auto ? `Time is up, but your answers could not be sent: ${error.message}` : error.message);
    }
  }

  function renderStart(errorMessage) {
    screen.innerHTML = `
      <section class="card start-layout">
        <div class="panel">
          <p class="panel-label">Student Entry</p>
          <h2>Join Your Assigned Test</h2>
          <p class="muted">Enter the join code from your teacher so we can load the correct question set for your event.</p>

          <div class="stack" style="margin-top:20px">
            <div>
              <label for="joinCode">Join Code</label>
              <input id="joinCode" type="text" placeholder="e.g. DEMO123" autocomplete="off" />
            </div>

            <div>
              <label for="name">Name</label>
              <input id="name" type="text" placeholder="e.g. Joe Tan" autocomplete="off" />
            </div>

            <div>
              <label for="group">Class / Group</label>
              <input id="group" type="text" placeholder="e.g. P6-3 / S1-2" autocomplete="off" />
            </div>
          </div>

          ${errorMessage ? `<p class="notice notice--danger">${escapeHtml(errorMessage)}</p>` : ""}

          <div class="nav">
            <span class="pill">Demo code: DEMO123</span>
            <button class="primary" id="startBtn">Launch challenge</button>
          </div>
        </div>

        <div class="panel panel--accent">
          <p class="panel-label">Challenge Rules</p>
          <h2>Play Fair, Think Deep</h2>
          <p class="muted">Each join code links to a specific event, so every student sees the right paper.</p>

          <ul class="rule-list">
            <li>Use only the code shared for your class event.</li>
            <li>Read every question carefully before moving on.</li>
            <li>Submit only when you are sure your answers are complete.</li>
          </ul>
        </div>
      </section>
    `;

    const joinCodeEl = document.getElementById("joinCode");
    const nameEl = document.getElementById("name");
    const groupEl = document.getElementById("group");
    const button = document.getElementById("startBtn");

    button.addEventListener("click", async () => {
      const joinCode = joinCodeEl.value.trim().toUpperCase();
      const name = nameEl.value.trim();
      const group = groupEl.value.trim();

      if (!joinCode || !name || !group) {
        renderStart("Please enter your join code, name, and class/group.");
        return;
      }

      try {
        button.disabled = true;
        button.textContent = "Loading...";

        const payload = await api("/api/attempts", {
          method: "POST",
          body: JSON.stringify({
            joinCode,
            studentName: name,
            studentGroup: group
          })
        });

        state.name = name;
        state.group = group;
        state.joinCode = payload.event.joinCode;
        state.eventTitle = payload.event.title;
        state.durationMinutes = payload.event.durationMinutes;
        state.attemptId = payload.attempt.id;
        state.attemptToken = payload.attempt.token;
        state.submitting = false;
        state.i = 0;
        state.answers = {};
        state.startedAt = Date.now();
        ACTIVE_BANK = payload.questions;

        startTimer(payload.attempt.deadlineAt, payload.serverNow);
        renderQuestion();
      } catch (error) {
        renderStart(error.message);
      }
    });
  }

  function renderQuestion() {
    const q = ACTIVE_BANK[state.i];
    const chosen = state.answers[q.id];
    const currentNumber = state.i + 1;
    const progressPct = Math.round((currentNumber / ACTIVE_BANK.length) * 100);

    const metaPills = `
      <div class="row" style="margin-top:12px">
        ${q.level ? `<span class="pill">${escapeHtml(q.level)}</span>` : ""}
        ${q.topic ? `<span class="pill">${escapeHtml(q.topic)}</span>` : ""}
        ${q.qType ? `<span class="pill">${escapeHtml(q.qType)}</span>` : ""}
      </div>
    `;

    const art = q.art ? `<pre>${escapeHtml(q.art)}</pre>` : "";
    const code = q.code
      ? `<p class="code-label">${escapeHtml(q.code.language)}</p><pre><code>${escapeHtml(q.code.source)}</code></pre>`
      : "";

    const optionsHtml = q.options.map((opt, idx) => {
      const checked = chosen === idx ? "checked" : "";

      return `
        <label class="opt">
          <input type="radio" name="opt" value="${idx}" ${checked} />
          <div class="opt__text">${escapeHtml(opt)}</div>
        </label>
      `;
    }).join("");

    screen.innerHTML = `
      <section class="card question-card">
        <div class="question-top">
          <div class="question-banner">
            <p class="panel-label">Current Mission</p>
            <h2>${escapeHtml(q.title)}</h2>
            <p class="muted">${escapeHtml(state.eventTitle)}</p>
            ${metaPills}
          </div>

          <div class="progress-panel">
            <p class="panel-label">Challenge Progress</p>
            <h3>${currentNumber} of ${ACTIVE_BANK.length}</h3>
            <p class="muted">${answeredCount()} answered so far / ${q.points} points for this question</p>
            <div class="progress-track" aria-hidden="true">
              <span style="width:${progressPct}%"></span>
            </div>
            <div class="row" style="margin-top:16px">
              <span class="pill">${progressPct}% complete</span>
              <span class="pill">${escapeHtml(state.joinCode)}</span>
              ${state.deadlineMs !== null ? `<span class="pill pill--timer" id="timerPill" role="timer" aria-live="off"></span>` : ""}
            </div>
          </div>
        </div>

        <div class="qbody">
          <div class="prompt-card">
            <div class="qhead">
              <div>
                <p class="panel-label">Question Prompt</p>
                <h3>${escapeHtml(q.id)}</h3>
              </div>
              <span class="pill">${q.points} pts</span>
            </div>

            <p class="prompt-text">${escapeHtml(q.prompt)}</p>
            ${art}
            ${code}
          </div>

          <div class="options-card">
            <p class="panel-label">Choose One Answer</p>
            <div class="options">${optionsHtml}</div>

            <div class="nav">
              <button id="backBtn" class="secondary" ${state.i === 0 ? "disabled" : ""}>Back</button>
              <div class="row">
                <span class="pill">Answered: ${answeredCount()} / ${ACTIVE_BANK.length}</span>
                <button class="primary" id="nextBtn">${state.i === ACTIVE_BANK.length - 1 ? "Submit challenge" : "Next mission"}</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    updateTimerPill();

    document.getElementById("backBtn").addEventListener("click", () => {
      state.i = clamp(state.i - 1, 0, ACTIVE_BANK.length - 1);
      renderQuestion();
    });

    document.getElementById("nextBtn").addEventListener("click", async () => {
      const selected = screen.querySelector('input[name="opt"]:checked');
      if (!selected) {
        alert("Pick an answer before continuing.");
        return;
      }

      state.answers[q.id] = Number(selected.value);

      if (state.i === ACTIVE_BANK.length - 1) {
        await submitAttempt();
      } else {
        state.i += 1;
        renderQuestion();
      }
    });
  }

  function renderResults(payload, { auto = false } = {}) {
    const score = payload.result.score;
    const perQ = payload.result.perQuestion;
    const max = payload.result.max;
    const mins = state.startedAt
      ? Math.max(1, Math.round((Date.now() - state.startedAt) / 60000))
      : null;

    const code = b64EncodeUnicode(JSON.stringify({
      name: state.name,
      group: state.group,
      joinCode: state.joinCode,
      eventTitle: state.eventTitle,
      score,
      max,
      answers: perQ.map(item => ({
        id: item.id,
        chosen: item.chosen,
        earned: item.earned,
        max: item.max
      }))
    }));

    const rows = perQ.map(item => {
      const isGood = item.earned === item.max;
      const meta = [item.level, item.topic, item.qType].filter(Boolean).join(" / ");

      return `
        <div class="result-row">
          <div>
            <strong>${escapeHtml(item.id)}</strong> ${escapeHtml(item.title)}
            ${meta ? `<div class="result-meta">${escapeHtml(meta)}</div>` : ""}
          </div>
          <div>${isGood ? `<span class="good">${item.earned}/${item.max}</span>` : `<span class="bad">${item.earned}/${item.max}</span>`}</div>
        </div>
      `;
    }).join("");

    screen.innerHTML = `
      <section class="card results-card">
        <div class="results-summary">
          <p class="panel-label">Challenge Complete</p>
          <h2>Nice Work, ${escapeHtml(state.name)}</h2>
          <p class="muted">${escapeHtml(state.group)} / ${escapeHtml(state.eventTitle)} / code ${escapeHtml(state.joinCode)}</p>

          <div class="summary-grid">
            <div class="summary-chip summary-chip--score">
              Score
              <strong>${score} / ${max}</strong>
            </div>
            <div class="summary-chip summary-chip--pace">
              Time
              <strong>${mins ? `${mins} min` : "N/A"}</strong>
            </div>
            <div class="summary-chip summary-chip--level">
              Answered
              <strong>${perQ.length}</strong>
            </div>
          </div>
        </div>

        <div class="results-breakdown" style="margin-top:18px">
          <p class="panel-label">Submission Status</p>
          <h3>Saved Online</h3>
          ${auto ? `<p class="notice">Time ran out, so your answers were submitted automatically.</p>` : ""}
          <p class="muted">Your answers were submitted to the backend successfully. Teachers can retrieve them from the event dashboard.</p>
        </div>

        <div class="results-breakdown" style="margin-top:18px">
          <p class="panel-label">Per Question</p>
          <h3>Breakdown</h3>
          <div style="margin-top:12px">${rows}</div>
        </div>

        <div class="results-breakdown" style="margin-top:18px">
          <p class="panel-label">Backup Result Code</p>
          <h3>Copy If Needed</h3>
          <p class="muted">This backup code is optional now, but it can still help if you want an extra submission record.</p>
          <div class="codebox">${code}</div>

          <div class="nav">
            <button id="restartBtn" class="secondary">Start another event</button>
            <button class="primary" id="copyBtn">Copy code</button>
          </div>
        </div>
      </section>
    `;

    document.getElementById("copyBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        alert("Copied.");
      } catch (_error) {
        alert("Could not auto-copy. Please select and copy manually.");
      }
    });

    document.getElementById("restartBtn").addEventListener("click", () => {
      ACTIVE_BANK = [];
      state.name = "";
      state.group = "";
      state.joinCode = "";
      state.eventTitle = "";
      state.durationMinutes = null;
      state.attemptId = null;
      state.attemptToken = null;
      state.deadlineMs = null;
      state.submitting = false;
      state.i = 0;
      state.answers = {};
      state.startedAt = null;
      stopTimer();
      renderStart();
    });
  }

  initTheme();
  renderStart();
})();
