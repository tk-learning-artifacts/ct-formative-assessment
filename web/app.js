(function () {
  const screen = document.getElementById("screen");
  const ATTEMPT_KEY = "ct-quest-attempt";
  const Types = window.CTQuestTypes;
  const h = { escapeHtml };

  // Waits before each retry of a failed submission, in seconds.
  const RETRY_DELAYS = [1, 2, 4, 8, 15, 30, 30, 30, 60, 60];

  // While answers are being marked, the results page checks back this often
  // (seconds), at most MARKING_POLLS times.
  const MARKING_POLL_SECONDS = 15;
  const MARKING_POLLS = 40;

  let ACTIVE_BANK = [];

  const state = {
    name: "",
    group: "",
    joinCode: "",
    eventTitle: "",
    attemptId: null,
    attemptToken: null,
    deadlineMs: null,
    timerId: null,
    markingTimerId: null,
    progressTimerId: null,
    submitting: false,
    committing: false,
    i: 0,
    answers: {},
    startedAt: null,
    // The event's settings (ADR 0003) and the answers committed so far,
    // keyed by question id, as policy.js lets this student see them:
    // { questionId, skipped, result? }, with result only under "each".
    feedbackMode: "release",
    navigationMode: "free",
    committed: {}
  };

  function isLinear() {
    return state.navigationMode === "linear";
  }

  function feedbackEach() {
    return state.feedbackMode === "each";
  }

  function isAnswered(q) {
    const committed = state.committed[q.id];
    return committed ? !committed.skipped : state.answers[q.id] !== undefined;
  }

  function answeredCount() {
    return ACTIVE_BANK.filter(isAnswered).length;
  }

  function skippedCount() {
    return ACTIVE_BANK.filter(q => state.committed[q.id] && state.committed[q.id].skipped).length;
  }

  // The first question not yet committed; under in-order navigation, the
  // furthest the student may be.
  function firstOpenIndex() {
    const index = ACTIVE_BANK.findIndex(q => !state.committed[q.id]);
    return index === -1 ? ACTIVE_BANK.length : index;
  }

  function setCommitted(progress) {
    state.committed = {};
    ((progress && progress.committed) || []).forEach(item => {
      state.committed[item.questionId] = item;
    });
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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ---------- Attempt saved in this tab (survives a refresh) ----------
  // sessionStorage can be missing or throw (private mode, blocked storage);
  // the test still works, it just cannot resume after a refresh.

  function saveAttempt(extra) {
    try {
      sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({
        attemptId: state.attemptId,
        token: state.attemptToken,
        answers: state.answers,
        i: state.i,
        name: state.name,
        group: state.group,
        joinCode: state.joinCode,
        ...extra
      }));
    } catch (_error) {
      // Ignore: resume is a convenience.
    }
  }

  function readSavedAttempt() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) || "null");
      return saved && saved.attemptId && saved.token ? saved : null;
    } catch (_error) {
      return null;
    }
  }

  function clearSavedAttempt() {
    try {
      sessionStorage.removeItem(ATTEMPT_KEY);
    } catch (_error) {
      // Ignore.
    }
  }

  // ---------- API ----------

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
      const error = new Error(payload.error || "Request failed.");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function attemptHeaders() {
    return { "X-Attempt-Token": state.attemptToken };
  }

  // ---------- Timer ----------

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
    pill.textContent = remaining > 0 ? `${formatRemaining(remaining)} left` : "Time is up";
    pill.classList.toggle("timer--low", remaining <= 60 * 1000);
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

  // ---------- Answers ----------

  function captureCurrentAnswer() {
    const q = ACTIVE_BANK[state.i];
    const container = document.getElementById("answerArea");

    // A committed answer is locked; nothing on the page can change it.
    if (!q || !container || state.committed[q.id]) {
      return;
    }

    const response = Types.get(q.type).readResponse(container, q);

    if (response === null) {
      delete state.answers[q.id];
    } else if (response !== undefined) {
      state.answers[q.id] = response;
    }

    saveAttempt();
    updateNavButtons();
  }

  // "Check answer", and "Next" under in-order navigation, need an answer.
  function updateNavButtons() {
    const q = ACTIVE_BANK[state.i];
    const answered = Boolean(q) && state.answers[q.id] !== undefined;

    ["checkBtn", "nextBtn"].forEach(id => {
      const button = document.getElementById(id);
      if (button && button.hasAttribute("data-needs-answer")) {
        button.disabled = !answered || state.committing;
      }
    });
  }

  function showStatus(message) {
    const el = document.getElementById("submitStatus");
    if (el) {
      el.textContent = message;
      el.hidden = !message;
    }
  }

  // Submits the answers. Network failures and server errors are retried with
  // growing waits, so an auto-submit at the deadline survives a flaky
  // connection; answers stay saved in this tab meanwhile.
  async function submitAttempt({ auto = false } = {}) {
    if (state.submitting || !state.attemptId) {
      return;
    }

    captureCurrentAnswer();
    stopProgressPoll();
    state.submitting = true;

    for (let attempt = 0; ; attempt += 1) {
      try {
        showStatus(attempt === 0 ? "Sending your answers..." : `Sending your answers (try ${attempt + 1})...`);
        const payload = await api(`/api/attempts/${state.attemptId}/submit`, {
          method: "POST",
          headers: attemptHeaders(),
          body: JSON.stringify({ answers: state.answers })
        });

        stopTimer();
        saveAttempt({ submitted: true });
        await showResults(payload, { auto });
        return;
      } catch (error) {
        if (error.status === 409) {
          // Already submitted (for example by another tab): show the result.
          stopTimer();
          await resumeAttempt(readSavedAttempt() || { attemptId: state.attemptId, token: state.attemptToken });
          return;
        }

        const retryable = !error.status || error.status >= 500;

        if (!retryable || attempt >= RETRY_DELAYS.length) {
          state.submitting = false;
          showStatus("");
          alert(auto ? `Time is up, but your answers could not be sent: ${error.message}` : error.message);
          return;
        }

        const wait = RETRY_DELAYS[attempt];
        showStatus(`Could not reach the server. Your answers are saved here; trying again in ${wait}s...`);
        await sleep(wait * 1000);
      }
    }
  }

  // ---------- Committing one answer ----------

  // Sends the current question's answer (or a skip) as final. On success the
  // answer is locked, and under "each" its result comes back. Returns
  // whether it was committed.
  async function commitCurrent({ skip = false } = {}) {
    const q = ACTIVE_BANK[state.i];

    if (!q || state.committing || state.committed[q.id]) {
      return Boolean(q && state.committed[q.id]);
    }

    captureCurrentAnswer();
    state.committing = true;
    updateNavButtons();

    try {
      const payload = await api(`/api/attempts/${state.attemptId}/answers/${encodeURIComponent(q.id)}/commit`, {
        method: "POST",
        headers: attemptHeaders(),
        body: JSON.stringify({ response: skip || state.answers[q.id] === undefined ? null : state.answers[q.id] })
      });

      if (skip) {
        delete state.answers[q.id];
      }

      setCommitted(payload.progress);
      saveAttempt();
      return true;
    } catch (error) {
      const code = error.payload && error.payload.code;

      if (code === "time-up") {
        await submitAttempt({ auto: true });
        return false;
      }

      if (code === "already-submitted" || code === "attempt-reset") {
        await resumeAttempt(readSavedAttempt() || { attemptId: state.attemptId, token: state.attemptToken });
        return false;
      }

      if (code === "answer-locked" || code === "out-of-order") {
        // Another tab moved on: take the server's record and carry on from it.
        await refreshProgress();
        return false;
      }

      showStatus(error.status ? error.message : "Could not reach the server. Your answer is saved here; try again.");
      return false;
    } finally {
      state.committing = false;
      updateNavButtons();
    }
  }

  // Re-reads the committed answers from the server and redraws the question.
  async function refreshProgress() {
    try {
      const payload = await api(`/api/attempts/${state.attemptId}`, { method: "GET", headers: attemptHeaders() });

      if (payload.attempt.status !== "started") {
        await resumeAttempt(readSavedAttempt() || { attemptId: state.attemptId, token: state.attemptToken });
        return;
      }

      setCommitted(payload.progress);

      if (isLinear()) {
        state.i = clamp(firstOpenIndex(), 0, ACTIVE_BANK.length - 1);
      }

      saveAttempt();
      renderQuestion();
    } catch (_error) {
      showStatus("Could not reach the server. Try again in a moment.");
    }
  }

  function stopProgressPoll() {
    if (state.progressTimerId) {
      clearTimeout(state.progressTimerId);
      state.progressTimerId = null;
    }
  }

  // Under "each", a checked AI-scored answer is marked in the background.
  // While any is still being marked, check back, and redraw the question if
  // it is the one on screen.
  function pollWhilePending(polls = 0) {
    stopProgressPoll();

    const pending = Object.values(state.committed).some(item => item.result && item.result.status === "pending");

    if (!pending || polls >= MARKING_POLLS) {
      return;
    }

    const attemptId = state.attemptId;

    state.progressTimerId = setTimeout(async () => {
      state.progressTimerId = null;

      try {
        const payload = await api(`/api/attempts/${attemptId}`, { method: "GET", headers: attemptHeaders() });

        if (state.attemptId !== attemptId || state.submitting || payload.attempt.status !== "started") {
          return;
        }

        setCommitted(payload.progress);
        const q = ACTIVE_BANK[state.i];

        if (q && state.committed[q.id]) {
          captureCurrentAnswer();
          renderQuestion({ polls: polls + 1 });
          return;
        }
      } catch (_error) {
        // Try again next time.
      }

      pollWhilePending(polls + 1);
    }, MARKING_POLL_SECONDS * 1000);
  }

  // ---------- Results, shared by the per-question feedback and the breakdown ----------

  function rendererFor(type) {
    try {
      return Types.get(type);
    } catch (_error) {
      return null;
    }
  }

  // item is one perQuestion entry from policy.js. Colour is never the only
  // signal: each status has a word beside it.
  function resultStatus(item) {
    return item.status === "pending"
      ? { tone: "pending", label: "Being marked" }
      : item.status === "needs-review" ? { tone: "warning", label: "Waiting for teacher" }
        : item.correct ? { tone: "positive", label: "Correct" }
          : item.earned > 0 ? { tone: "warning", label: "Part marks" }
            : { tone: "critical", label: "Incorrect" };
  }

  // The lines under a result: the student's answer, the correct one when
  // they missed it, feedback, and a note while it is being marked.
  function resultLines(item) {
    const renderer = rendererFor(item.type);
    const chosen = renderer ? renderer.describeResponse(item.response, h) : "";
    const correct = item.correctResponse && renderer ? renderer.describeResponse(item.correctResponse, h) : "";
    // detail is the student view from policy.js: who marked it and the
    // validated feedback text. It is escaped like everything else.
    const feedback = item.detail && item.detail.feedback ? item.detail.feedback : "";
    const feedbackLabel = item.detail && item.detail.source === "teacher" ? "Teacher's feedback" : "Feedback";
    const statusNote = item.status === "pending"
      ? "Being marked. Check back soon."
      : item.status === "needs-review" ? "Waiting for your teacher to mark this." : "";
    // Typed output and ordered lines are code, so they keep a code font.
    const isCode = item.type === "code-trace" || item.type === "parsons";
    const asCode = text => isCode ? `<code>${escapeHtml(text)}</code>` : escapeHtml(text);

    return `
      <div class="result-meta result-answer">Your answer: ${asCode(chosen)}</div>
      ${correct && !item.correct ? `<div class="result-meta result-answer">Correct answer: ${asCode(correct)}</div>` : ""}
      ${feedback ? `<div class="result-meta">${feedbackLabel}: ${escapeHtml(feedback)}</div>` : ""}
      ${statusNote ? `<div class="result-meta">${statusNote}</div>` : ""}
    `;
  }

  function resultScore(item) {
    const status = resultStatus(item);
    return `
      <span class="result-row__score tone-${status.tone === "pending" ? "neutral" : status.tone}">${item.earned}/${item.max}</span>
      <span class="tag status status--${status.tone}">${status.label}</span>
    `;
  }

  // The panel under a checked answer ("each"), or a plain note that a
  // committed answer is recorded.
  function committedPanel(q) {
    const committed = state.committed[q.id];

    if (!committed) {
      return "";
    }

    if (!committed.result) {
      return `<p class="notice q-feedback">${committed.skipped ? "Skipped. This question scores zero." : "Your answer is recorded."}</p>`;
    }

    return `
      <div class="q-feedback" role="status">
        <div class="q-feedback__head">
          ${resultScore(committed.result)}
          ${committed.skipped ? `<span class="muted small">Skipped</span>` : ""}
        </div>
        ${resultLines(committed.result)}
      </div>
    `;
  }

  // ---------- Screens ----------

  function renderStart(errorMessage) {
    stopTimer();
    screen.innerHTML = `
      <section class="card join">
        <form class="stack" id="joinForm" novalidate>
          <div class="section-heading">
            <h2>Join a test</h2>
            <p>Type the join code your teacher gave your class.</p>
          </div>

          <div class="field">
            <label for="joinCode">Join code <span class="field__hint">try DEMO123</span></label>
            <input id="joinCode" type="text" placeholder="DEMO123" autocomplete="off" autocapitalize="characters" spellcheck="false" />
          </div>

          <div class="field">
            <label for="name">Your name</label>
            <input id="name" type="text" placeholder="Joe Tan" autocomplete="off" />
          </div>

          <div class="field">
            <label for="group">Class</label>
            <input id="group" type="text" placeholder="P6-3 or S1-2" autocomplete="off" />
          </div>

          ${errorMessage ? `<p class="error-text" role="alert">${escapeHtml(errorMessage)}</p>` : ""}

          <button type="submit" class="btn btn--accent btn--block" id="startBtn">Start test</button>
        </form>

        <ul class="join__rules">
          <li>You get one attempt, so read each question carefully.</li>
          <li>You can submit from any question. Blank answers score zero.</li>
        </ul>
      </section>
    `;

    const button = document.getElementById("startBtn");

    // A form, so Enter in any field starts the test too.
    document.getElementById("joinForm").addEventListener("submit", async event => {
      event.preventDefault();
      const joinCode = document.getElementById("joinCode").value.trim().toUpperCase();
      const name = document.getElementById("name").value.trim();
      const group = document.getElementById("group").value.trim();

      if (!joinCode || !name || !group) {
        renderStart("Fill in your join code, name and class.");
        return;
      }

      try {
        button.disabled = true;
        button.textContent = "Starting...";

        const payload = await api("/api/attempts", {
          method: "POST",
          body: JSON.stringify({ joinCode, studentName: name, studentGroup: group })
        });

        state.name = name;
        state.group = group;
        state.attemptToken = payload.attempt.token;
        enterAttempt(payload, {}, 0);
      } catch (error) {
        const saved = readSavedAttempt();

        // This student already has an attempt running. If this tab holds its
        // token, carry on with it; otherwise only the teacher can help.
        if (error.status === 409 && error.payload && error.payload.code === "attempt-in-progress" &&
            saved && saved.attemptId === error.payload.attemptId) {
          await resumeAttempt(saved);
          return;
        }

        renderStart(error.message);
      }
    });
  }

  function enterAttempt(payload, answers, index) {
    state.joinCode = payload.event.joinCode;
    state.eventTitle = payload.event.title;
    state.attemptId = payload.attempt.id;
    state.name = payload.attempt.studentName || state.name;
    state.group = payload.attempt.studentGroup || state.group;
    state.submitting = false;
    state.answers = answers || {};
    state.startedAt = payload.attempt.startedAt ? Date.parse(payload.attempt.startedAt) : Date.now();
    ACTIVE_BANK = payload.questions;

    const progress = payload.progress || {};
    state.feedbackMode = progress.feedbackMode || payload.event.feedbackMode || "release";
    state.navigationMode = progress.navigationMode || payload.event.navigationMode || "free";
    setCommitted(progress);

    // In order: the question after the last committed one, or the last
    // committed one itself while its feedback is showing.
    let target = index || 0;

    if (isLinear()) {
      const open = firstOpenIndex();
      target = clamp(target, feedbackEach() ? open - 1 : open, open);
    }

    state.i = clamp(target, 0, Math.max(0, ACTIVE_BANK.length - 1));

    saveAttempt();
    startTimer(payload.attempt.deadlineAt, payload.serverNow);
    renderQuestion();

    if (state.deadlineMs !== null && Date.now() >= state.deadlineMs) {
      stopTimer();
      submitAttempt({ auto: true });
    }
  }

  // Picks up the attempt saved in this tab: back into the questions if it is
  // still open, or to the results if it was submitted.
  async function resumeAttempt(saved) {
    state.attemptId = saved.attemptId;
    state.attemptToken = saved.token;

    let payload;

    try {
      payload = await api(`/api/attempts/${saved.attemptId}`, { method: "GET", headers: attemptHeaders() });
    } catch (error) {
      if (!error.status || error.status >= 500) {
        renderStart("Could not reach the server to resume your test. Refresh to try again.");
        return;
      }

      clearSavedAttempt();
      renderStart(error.message);
      return;
    }

    if (payload.attempt.status === "reset") {
      clearSavedAttempt();
      renderStart("Your teacher reset your attempt. You can start again.");
      return;
    }

    state.name = payload.attempt.studentName;
    state.group = payload.attempt.studentGroup;

    if (payload.attempt.status === "submitted") {
      state.joinCode = payload.event.joinCode;
      state.eventTitle = payload.event.title;
      state.answers = saved.answers || {};
      state.startedAt = payload.attempt.startedAt ? Date.parse(payload.attempt.startedAt) : null;
      renderResults(payload);
      return;
    }

    enterAttempt(payload, saved.answers || {}, saved.i || 0);
  }

  // The buttons under the answer. Free navigation keeps Back and Next;
  // in order drops Back, and moving on means answering (Next commits) or
  // skipping. Under "each", Check answer commits and shows the result first.
  function navButtons(q, isLast) {
    const locked = Boolean(state.committed[q.id]);
    const answered = state.answers[q.id] !== undefined;
    const needsAnswer = `data-needs-answer ${answered ? "" : "disabled"}`;
    const buttons = [];

    if (!locked && isLinear()) {
      buttons.push(`<button class="btn btn--secondary" id="skipBtn">Skip</button>`);
    }

    if (!locked && feedbackEach()) {
      buttons.push(`<button class="btn btn--primary" id="checkBtn" ${needsAnswer}>Check answer</button>`);
    }

    if (!isLast) {
      const commitsOnNext = isLinear() && !locked && !feedbackEach();
      const hidden = isLinear() && !locked && feedbackEach();

      if (!hidden) {
        buttons.push(`<button class="btn ${feedbackEach() && !locked ? "btn--secondary" : "btn--primary"}" id="nextBtn" ${commitsOnNext ? needsAnswer : ""}>Next</button>`);
      }
    }

    buttons.push(`<button class="btn ${isLast ? "btn--accent" : "btn--secondary"}" id="submitBtn">Submit test</button>`);

    return `
      ${isLinear() ? "<span></span>" : `<button id="backBtn" class="btn btn--secondary" ${state.i === 0 ? "disabled" : ""}>Back</button>`}
      <div class="row">${buttons.join("")}</div>
    `;
  }

  // One line on how this test works, so the buttons make sense.
  function modeHint() {
    const parts = [];

    if (isLinear()) {
      parts.push("Questions come in order: answer or skip to move on. You can't go back.");
    }

    if (feedbackEach()) {
      parts.push(isLinear() ? "Check each answer to see if it's right." : "Check an answer to see if it's right. Checked answers are locked.");
    } else if (state.feedbackMode === "end") {
      parts.push("You'll see which answers were right when you submit.");
    }

    return parts.length ? `<p class="muted small q-hint">${parts.join(" ")}</p>` : "";
  }

  function goTo(index) {
    state.i = clamp(index, 0, ACTIVE_BANK.length - 1);
    saveAttempt();
    renderQuestion();
  }

  function renderQuestion({ polls = 0 } = {}) {
    const q = ACTIVE_BANK[state.i];
    const renderer = Types.get(q.type);
    const currentNumber = state.i + 1;
    const isLast = state.i === ACTIVE_BANK.length - 1;
    const answered = answeredCount();
    const skipped = skippedCount();
    const locked = Boolean(state.committed[q.id]);

    const meta = [q.level, q.topic, q.qType].filter(Boolean)
      .map(label => `<span class="concept-tag">${escapeHtml(label)}</span>`).join("");

    // One dot per question: filled once answered, dashed when skipped,
    // square once locked, ringed for this one. In order, the ones not
    // reached yet are faded. The strip's text says the same in words.
    const dots = ACTIVE_BANK.map((item, idx) => {
      const classes = ["progress__dot"];
      const committed = state.committed[item.id];
      if (committed && committed.skipped) {
        classes.push("progress__dot--skipped");
      } else if (isAnswered(item)) {
        classes.push("progress__dot--done");
      }
      if (committed) {
        classes.push("progress__dot--locked");
      }
      if (isLinear() && idx > state.i) {
        classes.push("progress__dot--ahead");
      }
      if (idx === state.i) {
        classes.push("progress__dot--current");
      }
      return `<li class="${classes.join(" ")}">${idx + 1}</li>`;
    }).join("");

    const art = q.art ? `<pre>${escapeHtml(q.art)}</pre>` : "";
    const code = !q.code ? "" : renderer.renderCode
      ? renderer.renderCode(q.code, h)
      : `<p class="code-label">${escapeHtml(q.code.language)}</p><pre><code>${escapeHtml(q.code.source)}</code></pre>`;

    screen.innerHTML = `
      <div class="q-strip">
        <span class="q-strip__count">Question ${currentNumber} of ${ACTIVE_BANK.length}</span>
        <ol class="progress" aria-hidden="true">${dots}</ol>
        <span class="muted small">${answered} answered${skipped ? `, ${skipped} skipped` : ""}</span>
        ${state.deadlineMs !== null ? `<span class="timer" id="timerPill" role="timer" aria-live="off"></span>` : ""}
        <span class="q-strip__event">${escapeHtml(state.eventTitle)} <span class="mono">${escapeHtml(state.joinCode)}</span></span>
      </div>

      <div class="q-layout">
        <section class="card" aria-labelledby="questionTitle">
          <div class="q-head">
            <h2 id="questionTitle">${escapeHtml(q.title)}</h2>
            <span class="q-points">${q.points} point${q.points === 1 ? "" : "s"}</span>
          </div>
          <div class="concept-tags q-meta">${meta}</div>

          <p class="prompt-text">${escapeHtml(q.prompt)}</p>
          ${art}
          ${code}
          ${renderer.renderContext ? renderer.renderContext(q, h) : ""}
        </section>

        <section class="card" aria-label="Your answer">
          <div id="answerArea">${locked
            ? `<fieldset class="answer-locked" disabled data-locked>${renderer.renderInput(q, state.answers[q.id], h)}</fieldset>`
            : renderer.renderInput(q, state.answers[q.id], h)}</div>

          ${committedPanel(q)}
          ${modeHint()}

          <p class="notice q-status" id="submitStatus" role="status" hidden></p>

          <div class="q-nav">${navButtons(q, isLast)}</div>
        </section>
      </div>
    `;

    updateTimerPill();
    pollWhilePending(polls);

    const answerArea = document.getElementById("answerArea");
    answerArea.addEventListener("change", captureCurrentAnswer);
    answerArea.addEventListener("input", captureCurrentAnswer);

    const backBtn = document.getElementById("backBtn");

    if (backBtn) {
      backBtn.addEventListener("click", () => {
        captureCurrentAnswer();
        goTo(state.i - 1);
      });
    }

    const nextBtn = document.getElementById("nextBtn");

    if (nextBtn) {
      nextBtn.addEventListener("click", async () => {
        captureCurrentAnswer();

        // In order without per-question feedback, leaving a question is what
        // records it.
        if (isLinear() && !state.committed[q.id] && !(await commitCurrent())) {
          return;
        }

        goTo(state.i + 1);
      });
    }

    const checkBtn = document.getElementById("checkBtn");

    if (checkBtn) {
      checkBtn.addEventListener("click", async () => {
        if (await commitCurrent()) {
          renderQuestion();
        }
      });
    }

    const skipBtn = document.getElementById("skipBtn");

    if (skipBtn) {
      skipBtn.addEventListener("click", async () => {
        const message = feedbackEach()
          ? "Skip this question? You'll see the answer, but you can't come back to it. It scores zero."
          : "Skip this question? You can't come back to it. It scores zero.";

        if (!confirm(message)) {
          return;
        }

        if (!(await commitCurrent({ skip: true }))) {
          return;
        }

        if (feedbackEach() || isLast) {
          renderQuestion();
        } else {
          goTo(state.i + 1);
        }
      });
    }

    document.getElementById("submitBtn").addEventListener("click", async () => {
      captureCurrentAnswer();
      const missing = ACTIVE_BANK.filter(item => !state.committed[item.id] && state.answers[item.id] === undefined).length;
      const message = isLinear()
        ? `${missing} question${missing === 1 ? " has" : "s have"} no answer yet, including any you haven't reached. Submit anyway? They score zero.`
        : `You have ${missing} unanswered question${missing === 1 ? "" : "s"}. Submit anyway? Unanswered questions score zero.`;

      if (missing > 0 && !confirm(message)) {
        return;
      }

      await submitAttempt();
    });
  }

  // After submitting: the total comes straight back. The token-guarded GET
  // adds how many answers are still being marked and, once the teacher has
  // released it, the breakdown.
  async function showResults(submitPayload, { auto }) {
    let view = { attempt: submitPayload.attempt, event: { title: state.eventTitle, joinCode: state.joinCode }, result: submitPayload.result };

    try {
      view = await api(`/api/attempts/${state.attemptId}`, { method: "GET", headers: attemptHeaders() });
    } catch (_error) {
      // Show the total; the rest can be fetched again on refresh.
    }

    renderResults(view, { auto });
  }

  function stopMarkingPoll() {
    if (state.markingTimerId) {
      clearTimeout(state.markingTimerId);
      state.markingTimerId = null;
    }
  }

  // AI-scored answers are marked after submit, so the total can rise. Check
  // back a few times while any are still pending.
  function pollWhileMarking(pending, { auto, polls = 0 }) {
    stopMarkingPoll();

    if (!pending || polls >= MARKING_POLLS) {
      return;
    }

    const attemptId = state.attemptId;

    state.markingTimerId = setTimeout(async () => {
      state.markingTimerId = null;

      try {
        const view = await api(`/api/attempts/${attemptId}`, { method: "GET", headers: attemptHeaders() });

        if (state.attemptId === attemptId && view.attempt.status === "submitted") {
          renderResults(view, { auto, polls: polls + 1 });
        }
      } catch (_error) {
        if (state.attemptId === attemptId) {
          pollWhileMarking(pending, { auto, polls: polls + 1 });
        }
      }
    }, MARKING_POLL_SECONDS * 1000);
  }

  function renderResults(payload, { auto = false, polls = 0 } = {}) {
    stopTimer();
    stopProgressPoll();

    const result = payload.result || { score: 0, max: 0, breakdownReleased: false };
    const pendingCount = result.pending || 0;
    const perQ = result.perQuestion || null;
    const late = payload.attempt && payload.attempt.late;
    const mins = state.startedAt
      ? Math.max(1, Math.round((Date.now() - state.startedAt) / 60000))
      : null;

    // The backup code records the student's own answers and total only.
    const code = b64EncodeUnicode(JSON.stringify({
      name: state.name,
      group: state.group,
      joinCode: state.joinCode,
      eventTitle: state.eventTitle,
      attemptId: state.attemptId,
      score: result.score,
      max: result.max,
      answers: state.answers
    }));

    const rows = perQ ? perQ.map(item => {
      const meta = [item.level, item.topic, item.qType].filter(Boolean).join(" · ");

      return `
        <li class="result-row">
          <div>
            <strong>${escapeHtml(item.title || item.id)}</strong>
            ${meta ? `<div class="result-meta">${escapeHtml(meta)}</div>` : ""}
            ${resultLines(item)}
          </div>
          <div class="result-row__side">${resultScore(item)}</div>
        </li>
      `;
    }).join("") : "";

    screen.innerHTML = `
      <div class="stack">
        <section class="card">
          <div class="section-heading">
            <h2>Your answers are in, ${escapeHtml(state.name)}</h2>
            <p class="muted small">${escapeHtml(state.group)} · ${escapeHtml(state.eventTitle)} · <span class="mono">${escapeHtml(state.joinCode)}</span></p>
          </div>

          <dl class="stats">
            <div class="stat"><dt>Score</dt><dd>${result.score} / ${result.max}</dd></div>
            <div class="stat"><dt>Time</dt><dd>${mins ? `${mins} min` : "Not known"}</dd></div>
            <div class="stat"><dt>Answered</dt><dd>${Object.keys(state.answers).length}</dd></div>
          </dl>

          <div class="stack stack--tight mt-m">
            ${auto ? `<p class="notice notice--warning">Time ran out, so your answers were sent automatically.</p>` : ""}
            ${late ? `<p class="notice notice--warning">This came in after the time limit, so your teacher will see it marked late.</p>` : ""}
            ${pendingCount ? `<p class="notice">${pendingCount} written answer${pendingCount === 1 ? " is" : "s are"} still being marked, so your score may go up. This page checks again every ${MARKING_POLL_SECONDS} seconds.</p>` : ""}
            <p class="muted small">Your teacher can see your answers now.</p>
          </div>
        </section>

        <section class="card">
          <div class="section-heading">
            <h2>Question by question</h2>
          </div>
          ${perQ
            ? `<ol class="breakdown">${rows}</ol>`
            : `<p class="muted">Your teacher will show you which questions you got right later. Come back to this page, or ask your teacher.</p>`}
        </section>

        <section class="card card--raised">
          <details class="backup">
            <summary>Backup code</summary>
            <p class="muted small mt-s">You won't usually need this. It holds a copy of your answers and score, in case your teacher asks for it.</p>
            <div class="codebox">${code}</div>
            <div class="row mt-s">
              <button class="btn btn--secondary btn--sm" id="copyBtn">Copy code</button>
            </div>
          </details>
        </section>

        <div class="row">
          <button id="restartBtn" class="btn btn--secondary">Start another test</button>
        </div>
      </div>
    `;

    pollWhileMarking(pendingCount, { auto, polls });

    document.getElementById("copyBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        alert("Copied.");
      } catch (_error) {
        alert("Could not auto-copy. Please select and copy manually.");
      }
    });

    document.getElementById("restartBtn").addEventListener("click", () => {
      stopMarkingPoll();
      ACTIVE_BANK = [];
      state.name = "";
      state.group = "";
      state.joinCode = "";
      state.eventTitle = "";
      state.attemptId = null;
      state.attemptToken = null;
      state.deadlineMs = null;
      state.submitting = false;
      state.i = 0;
      state.answers = {};
      state.startedAt = null;
      state.feedbackMode = "release";
      state.navigationMode = "free";
      state.committed = {};
      clearSavedAttempt();
      renderStart();
    });
  }

  async function boot() {
    try {
      await Types.load();
    } catch (_error) {
      screen.innerHTML = `<section class="card"><p class="notice notice--critical">Could not load the test. Check your connection and refresh.</p></section>`;
      return;
    }

    const saved = readSavedAttempt();

    if (saved) {
      await resumeAttempt(saved);
      return;
    }

    renderStart();
  }

  boot();
})();
