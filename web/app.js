(function () {
  const screen = document.getElementById("screen");
  const ATTEMPT_KEY = "ct-quest-attempt";
  const Types = window.CTQuestTypes;
  const Visuals = window.CTQuestVisuals;
  const QuestView = window.CTQuestView;
  const h = { escapeHtml };

  // Waits before each retry of a failed submission, in seconds.
  const RETRY_DELAYS = [1, 2, 4, 8, 15, 30, 30, 30, 60, 60];

  // While answers are being marked, the results page checks back this often
  // (seconds), at most MARKING_POLLS times.
  const MARKING_POLL_SECONDS = 15;
  const MARKING_POLLS = 40;

  // During a challenge the page also re-reads the attempt this often (seconds),
  // and after each move between questions, so a teacher's change to the
  // settings or the time reaches the student (ADR 0003 §10).
  const SETTINGS_POLL_SECONDS = 30;

  // The questions this student holds, in order. Under in-order navigation
  // the server sends them one at a time (the ones reached so far), so this
  // can be shorter than state.questionCount, the number in the challenge.
  let ACTIVE_BANK = [];

  const state = {
    name: "",
    group: "",
    joinCode: "",
    // The /api/events/join payload, kept between the two join steps.
    joinEvent: null,
    eventTitle: "",
    attemptId: null,
    attemptToken: null,
    deadlineMs: null,
    deadlineAt: null,
    timerId: null,
    markingTimerId: null,
    progressTimerId: null,
    submitting: false,
    committing: false,
    // True while the question screen is showing, so the settings poll
    // knows to keep going.
    inAttempt: false,
    syncing: false,
    markingPolls: 0,
    // A one-off note that the teacher changed the settings, shown until the
    // student moves to another question.
    notice: "",
    i: 0,
    questionCount: 0,
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

  // Takes questions from the server: the full list from a start or a full
  // read, or the one a commit under in-order navigation sends next. The
  // list only ever grows, in the server's order.
  function holdQuestions(questions, count) {
    if (Array.isArray(questions) && questions.length > ACTIVE_BANK.length) {
      ACTIVE_BANK = questions;
    }

    if (count) {
      state.questionCount = count;
    }

    state.questionCount = Math.max(state.questionCount, ACTIVE_BANK.length);
  }

  function holdNext(question) {
    if (question && !ACTIVE_BANK.some(q => q.id === question.id)) {
      ACTIVE_BANK = ACTIVE_BANK.concat([question]);
      state.questionCount = Math.max(state.questionCount, ACTIVE_BANK.length);
    }
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
    state.deadlineAt = deadlineAt || null;

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

  // Starts the timer, and submits at once if the deadline has already
  // passed (for example, the teacher moved it earlier). A late submit is
  // still stored; the server flags it for the teacher.
  function applyDeadline(deadlineAt, serverNow) {
    startTimer(deadlineAt, serverNow);

    if (state.deadlineMs !== null && Date.now() >= state.deadlineMs) {
      stopTimer();
      submitAttempt({ auto: true });
    }
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
  // capture: false leaves the question on screen out, for a skip that ran
  // into the time limit.
  async function submitAttempt({ auto = false, capture = true } = {}) {
    if (state.submitting || !state.attemptId) {
      return;
    }

    if (capture) {
      captureCurrentAnswer();
    }

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

  // While a commit is in flight the answer cannot be edited, so the locked
  // answer drawn afterwards is always the one the server stored.
  function setAnswerAreaBusy(busy) {
    const area = document.getElementById("answerArea");

    if (area) {
      area.inert = busy;
      area.classList.toggle("answer-area--busy", busy);
      area.setAttribute("aria-busy", busy ? "true" : "false");
    }
  }

  function postCommit(q, response) {
    return api(`/api/attempts/${state.attemptId}/answers/${encodeURIComponent(q.id)}/commit`, {
      method: "POST",
      headers: attemptHeaders(),
      body: JSON.stringify({ response: response === undefined ? null : response })
    });
  }

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
    setAnswerAreaBusy(true);
    updateNavButtons();

    try {
      const payload = await postCommit(q, skip ? null : state.answers[q.id]);

      if (skip) {
        delete state.answers[q.id];
      }

      holdNext(payload.next);
      setCommitted(payload.progress);
      state.markingPolls = 0;
      saveAttempt();
      return true;
    } catch (error) {
      const code = error.payload && error.payload.code;

      if (code === "time-up") {
        // A skipped question is sent blank, whatever was typed into it.
        if (skip) {
          delete state.answers[q.id];
          saveAttempt();
        }

        state.committing = false;
        await submitAttempt({ auto: true, capture: !skip });
        return false;
      }

      if (code === "already-submitted" || code === "attempt-reset") {
        await resumeAttempt(readSavedAttempt() || { attemptId: state.attemptId, token: state.attemptToken });
        return false;
      }

      if (code === "answer-locked") {
        // Already stored: a response that never arrived, or another tab.
        // Show what the server has for this question before moving on.
        state.committing = false;
        await syncFromServer({ stayOn: q.id });
        return false;
      }

      if (code === "out-of-order" || code === "commit-not-used") {
        // Another tab moved on, or the teacher changed the settings: take
        // the server's record and carry on from it.
        state.committing = false;
        await syncFromServer();
        return false;
      }

      showStatus(error.status ? error.message : "Could not reach the server. Your answer is saved here; try again.");
      return false;
    } finally {
      state.committing = false;
      setAnswerAreaBusy(false);
      updateNavButtons();
    }
  }

  // ---------- Picking up the teacher's changes ----------

  function stopProgressPoll() {
    if (state.progressTimerId) {
      clearTimeout(state.progressTimerId);
      state.progressTimerId = null;
    }
  }

  function hasPendingResult() {
    return Object.values(state.committed).some(item => item.result && item.result.status === "pending");
  }

  // Re-reads the attempt in a while: every MARKING_POLL_SECONDS while an
  // answer checked under "each" is being marked (at most MARKING_POLLS
  // times), otherwise every SETTINGS_POLL_SECONDS.
  function scheduleSync() {
    stopProgressPoll();

    if (!state.inAttempt || state.submitting) {
      return;
    }

    const marking = hasPendingResult() && state.markingPolls < MARKING_POLLS;

    state.progressTimerId = setTimeout(() => {
      state.progressTimerId = null;

      if (marking) {
        state.markingPolls += 1;
      }

      syncFromServer();
    }, (marking ? MARKING_POLL_SECONDS : SETTINGS_POLL_SECONDS) * 1000);
  }

  // What the question screen shows of the attempt, for telling whether a
  // re-read changed anything: the settings, the deadline, which questions
  // are locked or skipped, and the result under the current question. A
  // result arriving for another question does not redraw the one being
  // answered.
  function progressSignature() {
    const q = ACTIVE_BANK[state.i];
    const locked = ACTIVE_BANK.map(item => state.committed[item.id] ? (state.committed[item.id].skipped ? "s" : "c") : "-").join("");
    return JSON.stringify([state.eventTitle, state.feedbackMode, state.navigationMode, state.deadlineAt, locked, q ? state.committed[q.id] || null : null]);
  }

  // What the status poll (GET /api/attempts/:id?fields=status) reports, and
  // the same built from what this page holds: the settings, the deadline,
  // and each committed answer with its marking status (only under "each").
  // When the two differ, the page fetches the full attempt.
  function statusSignature(progress, deadlineAt) {
    const committed = ((progress && progress.committed) || []).map(item => [item.questionId, item.skipped, item.status || null]);
    return JSON.stringify([progress && progress.feedbackMode, progress && progress.navigationMode, deadlineAt || null, committed]);
  }

  function heldStatusSignature() {
    const committed = Object.values(state.committed).map(item => ({
      questionId: item.questionId,
      skipped: item.skipped,
      status: item.result ? item.result.status : null
    }));
    return statusSignature({ feedbackMode: state.feedbackMode, navigationMode: state.navigationMode, committed }, state.deadlineAt);
  }

  // The first question with neither a committed nor a typed answer, or, if
  // every one has something, the last uncommitted question.
  function firstUnansweredIndex() {
    const open = ACTIVE_BANK.findIndex(q => !state.committed[q.id] && state.answers[q.id] === undefined);

    if (open !== -1) {
      return open;
    }

    for (let idx = ACTIVE_BANK.length - 1; idx >= 0; idx -= 1) {
      if (!state.committed[ACTIVE_BANK[idx].id]) {
        return idx;
      }
    }

    return ACTIVE_BANK.length - 1;
  }

  // The teacher switched to in order mid-challenge. The student carries on from
  // the first question they have not answered; the answers they gave before
  // it are committed now, in order, so they cannot go back to them.
  async function catchUpInOrder() {
    const target = firstUnansweredIndex();
    state.committing = true;

    try {
      for (let idx = 0; idx < target; idx += 1) {
        const q = ACTIVE_BANK[idx];

        if (state.committed[q.id]) {
          continue;
        }

        const payload = await postCommit(q, state.answers[q.id]);
        holdNext(payload.next);
        setCommitted(payload.progress);
      }
    } catch (error) {
      const code = error.payload && error.payload.code;

      if (code === "time-up") {
        state.committing = false;
        await submitAttempt({ auto: true });
        return;
      }

      // Anything not committed is still sent with the rest at submit.
      showStatus(error.status ? error.message : "Could not reach the server. Your answers are saved here.");
    } finally {
      state.committing = false;
    }

    state.i = clamp(Math.min(target, firstOpenIndex()), 0, ACTIVE_BANK.length - 1);
  }

  // A note on what the teacher changed, in the student's terms.
  function changeNotice(before) {
    const parts = [];

    if (before.navigationMode !== state.navigationMode) {
      parts.push(isLinear()
        ? "Questions now come in order, and you can't go back. The answers you had given are recorded."
        : "You can now move between questions. Answers already locked stay locked.");
    }

    if (before.feedbackMode !== state.feedbackMode) {
      parts.push(feedbackEach()
        ? "You can now check each answer to see if it's right."
        : state.feedbackMode === "end"
          ? "You'll see which answers were right when you submit."
          : "Your teacher will show you which answers were right later.");
    }

    if (before.deadlineAt !== state.deadlineAt) {
      parts.push(state.deadlineAt ? "The time for this challenge has changed." : "This challenge no longer has a time limit.");
    }

    return parts.length ? `Your teacher changed this challenge. ${parts.join(" ")}` : "";
  }

  // Re-reads the attempt: settings, committed answers and the deadline. The
  // status poll comes first and carries no questions; only if it differs
  // from what the page holds (or stayOn is set) is the full attempt fetched.
  // If anything changed, the question is redrawn (the timer restarts with
  // the new deadline). stayOn keeps the student on that question, to show
  // its stored result, instead of moving them to the first open one.
  async function syncFromServer({ stayOn = null } = {}) {
    if (!state.attemptId || !state.inAttempt || state.submitting || state.committing || state.syncing) {
      scheduleSync();
      return;
    }

    const attemptId = state.attemptId;
    const stillHere = () => state.attemptId === attemptId && !state.submitting && !state.committing && state.inAttempt;
    state.syncing = true;

    try {
      const status = await api(`/api/attempts/${attemptId}?fields=status`, { method: "GET", headers: attemptHeaders() });

      if (!stillHere()) {
        return;
      }

      if (status.attempt.status === "started" && !stayOn &&
          statusSignature(status.progress, status.attempt.deadlineAt) === heldStatusSignature()) {
        return;
      }

      const payload = status.attempt.status === "started"
        ? await api(`/api/attempts/${attemptId}`, { method: "GET", headers: attemptHeaders() })
        : status;

      if (!stillHere()) {
        return;
      }

      if (payload.attempt.status !== "started") {
        state.syncing = false;
        await resumeAttempt(readSavedAttempt() || { attemptId: state.attemptId, token: state.attemptToken });
        return;
      }

      captureCurrentAnswer();
      holdQuestions(payload.questions, payload.questionCount);

      const before = { feedbackMode: state.feedbackMode, navigationMode: state.navigationMode, deadlineAt: state.deadlineAt };
      const signature = progressSignature();
      const progress = payload.progress || {};

      state.eventTitle = payload.event.title;
      state.feedbackMode = progress.feedbackMode || state.feedbackMode;
      state.navigationMode = progress.navigationMode || state.navigationMode;
      setCommitted(progress);

      if ((payload.attempt.deadlineAt || null) !== state.deadlineAt) {
        applyDeadline(payload.attempt.deadlineAt, payload.serverNow);

        if (state.submitting) {
          return;
        }
      }

      if (progressSignature() === signature && !stayOn) {
        return;
      }

      state.notice = changeNotice(before) || state.notice;

      if (before.navigationMode !== "linear" && isLinear()) {
        await catchUpInOrder();

        if (state.submitting) {
          return;
        }
      } else if (stayOn && state.committed[stayOn]) {
        state.i = ACTIVE_BANK.findIndex(q => q.id === stayOn);
      } else if (isLinear()) {
        state.i = clamp(firstOpenIndex(), 0, ACTIVE_BANK.length - 1);
      }

      saveAttempt();
      renderQuestion();
    } catch (_error) {
      // Try again at the next poll or move.
    } finally {
      state.syncing = false;
      scheduleSync();
    }
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

  // Step 1 of joining: just the code. Step 2 (renderDetails) asks for the
  // student's name and class once the code is known to match a challenge.
  function renderJoinCode(errorMessage) {
    stopTimer();
    state.inAttempt = false;
    stopProgressPoll();
    screen.innerHTML = `
      <section class="card join">
        <form class="stack" id="joinForm" novalidate>
          <div class="section-heading">
            <h2>Join a challenge</h2>
            <p>Type the join code your teacher gave your class.</p>
          </div>

          <div class="field">
            <label for="joinCode">Join code</label>
            <input id="joinCode" type="text" value="${escapeHtml(state.joinCode)}" autocomplete="off" autocapitalize="characters" spellcheck="false" />
          </div>

          ${errorMessage ? `<p class="error-text" role="alert">${escapeHtml(errorMessage)}</p>` : ""}

          <button type="submit" class="btn btn--accent btn--block" id="joinBtn">Next</button>
        </form>
      </section>
    `;

    const button = document.getElementById("joinBtn");
    const input = document.getElementById("joinCode");
    input.focus();

    document.getElementById("joinForm").addEventListener("submit", async event => {
      event.preventDefault();
      const joinCode = input.value.trim().toUpperCase();

      if (!joinCode) {
        state.joinCode = "";
        renderJoinCode("Type your join code.");
        return;
      }

      try {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.textContent = "Checking...";

        const payload = await api("/api/events/join", {
          method: "POST",
          body: JSON.stringify({ joinCode })
        });

        state.joinCode = payload.event.joinCode;
        state.joinEvent = payload;
        renderDetails();
      } catch (error) {
        state.joinCode = joinCode;
        renderJoinCode(error.status ? error.message : "Could not reach the server. Check your connection and try again.");
      }
    });
  }

  function renderStart(errorMessage) {
    renderJoinCode(errorMessage);
  }

  function renderDetails(errorMessage) {
    if (!state.joinEvent) {
      renderJoinCode();
      return;
    }

    stopTimer();
    state.inAttempt = false;
    stopProgressPoll();

    const info = state.joinEvent;
    const linear = info.event.navigationMode === "linear";
    const facts = [
      escapeHtml(info.event.title),
      `<span class="mono">${escapeHtml(state.joinCode)}</span>`,
      `${info.questionCount} question${info.questionCount === 1 ? "" : "s"}`
    ];

    if (info.event.durationMinutes) facts.push(`${escapeHtml(String(info.event.durationMinutes))} min`);

    screen.innerHTML = `
      <section class="card join">
        <form class="stack" id="detailsForm" novalidate>
          <div class="section-heading">
            <h2 id="detailsTitle" tabindex="-1">Your details</h2>
            <p>${facts.join(" · ")}</p>
          </div>

          <div class="field">
            <label for="name">Your name</label>
            <input id="name" type="text" value="${escapeHtml(state.name)}" placeholder="Joe Tan" autocomplete="off" />
          </div>

          <div class="field">
            <label for="group">Class</label>
            <input id="group" type="text" value="${escapeHtml(state.group)}" placeholder="P6-3 or S1-2" autocomplete="off" />
          </div>

          ${errorMessage ? `<p class="error-text" role="alert">${escapeHtml(errorMessage)}</p>` : ""}

          <div class="q-nav">
            <button type="button" class="btn btn--secondary" id="changeCodeBtn">Change code</button>
            <button type="submit" class="btn btn--accent" id="startBtn">Start challenge</button>
          </div>
        </form>

        <ul class="join__rules">
          <li>You get one attempt, so read each question carefully.</li>
          ${linear
            ? "<li>Questions come in order. Answer or skip each one to move on; you can't go back.</li>"
            : "<li>You can skip a question and come back to it. Submit at the end, where you'll see any you haven't answered.</li>"}
        </ul>
      </section>
    `;

    const button = document.getElementById("startBtn");
    document.getElementById("name").focus();

    document.getElementById("changeCodeBtn").addEventListener("click", () => {
      state.name = document.getElementById("name").value.trim();
      state.group = document.getElementById("group").value.trim();
      renderJoinCode();
    });

    // A form, so Enter in any field starts the challenge too.
    document.getElementById("detailsForm").addEventListener("submit", async event => {
      event.preventDefault();
      const name = document.getElementById("name").value.trim();
      const group = document.getElementById("group").value.trim();
      const joinCode = state.joinCode;

      if (!name || !group) {
        state.name = name;
        state.group = group;
        renderDetails("Fill in your name and class.");
        return;
      }

      try {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
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

        state.name = name;
        state.group = group;

        // The challenge closed or vanished between the two steps.
        if (error.status === 404) {
          renderJoinCode(error.message);
          return;
        }

        renderDetails(error.message);
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
    state.questionCount = Math.max(payload.questionCount || 0, ACTIVE_BANK.length);

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

    state.inAttempt = true;
    state.notice = "";
    state.markingPolls = 0;
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
        renderStart("Could not reach the server to resume your challenge. Refresh to try again.");
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

    buttons.push(`<button class="btn ${isLast ? "btn--accent" : "btn--secondary"}" id="submitBtn">Submit answers</button>`);

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

  // Moves to a question, then re-reads the attempt in the background in case
  // the teacher changed something.
  function goTo(index) {
    state.i = clamp(index, 0, ACTIVE_BANK.length - 1);
    state.notice = "";
    saveAttempt();
    renderQuestion();
    syncFromServer();
  }

  // Free navigation: a dot jumps to its question, saving the answer on
  // screen first, as Next does. Focus follows to the new current dot,
  // because the redraw replaces the one that was clicked. On a phone the
  // row scrolls sideways; it is kept scrolled to the current question.
  function bindProgressDots() {
    const row = document.getElementById("progressDots");

    if (!row) {
      return;
    }

    const current = row.querySelector(".progress__dot--current");

    if (current && row.scrollWidth > row.clientWidth) {
      const rowBox = row.getBoundingClientRect();
      const dotBox = current.getBoundingClientRect();
      row.scrollLeft = Math.max(0, row.scrollLeft + dotBox.left - rowBox.left - (rowBox.width - dotBox.width) / 2);
    }

    row.addEventListener("click", event => {
      const button = event.target.closest("[data-goto]");

      if (!button || state.committing || state.submitting) {
        return;
      }

      const index = Number(button.dataset.goto);

      if (index === state.i) {
        return;
      }

      captureCurrentAnswer();
      goTo(index);

      const focus = document.querySelector(`#progressDots [data-goto="${state.i}"]`);

      if (focus) {
        focus.focus();
      }
    });
  }

  function renderQuestion() {
    const q = ACTIVE_BANK[state.i];
    const currentNumber = state.i + 1;
    const isLast = state.i === state.questionCount - 1;
    const answered = answeredCount();
    const skipped = skippedCount();
    const locked = Boolean(state.committed[q.id]);

    // One dot per question in the test: filled once answered, dashed when
    // skipped, square once locked, ringed for this one. In order, the ones
    // not reached yet are faded (and not held by the page at all). Under
    // free navigation each dot is a button that jumps to its question, and
    // its label says the same as the dot in words.
    const jumpable = !isLinear();
    const dots = Array.from({ length: state.questionCount }, (_unused, idx) => {
      const item = ACTIVE_BANK[idx];
      const committed = item ? state.committed[item.id] : null;
      const classes = ["progress__dot"];
      const words = [`Question ${idx + 1}`];

      if (committed && committed.skipped) {
        classes.push("progress__dot--skipped");
        words.push("skipped");
      } else if (item && isAnswered(item)) {
        classes.push("progress__dot--done");
        words.push("answered");
      } else {
        words.push("not answered");
      }
      if (committed) {
        classes.push("progress__dot--locked");
        words.push("locked");
      }
      if (isLinear() && idx > state.i) {
        classes.push("progress__dot--ahead");
      }
      if (idx === state.i) {
        classes.push("progress__dot--current");
      }

      const dot = `<span class="${classes.join(" ")}">${idx + 1}</span>`;

      return jumpable && item
        ? `<li><button type="button" class="progress__jump" data-goto="${idx}" aria-label="${words.join(", ")}" ${idx === state.i ? `aria-current="step"` : ""}>${dot}</button></li>`
        : `<li>${dot}</li>`;
    }).join("");

    screen.innerHTML = `
      <div class="q-strip">
        <span class="q-strip__count">Question ${currentNumber} of ${state.questionCount}</span>
        ${jumpable
          ? `<ol class="progress progress--jump" id="progressDots" aria-label="Questions">${dots}</ol>`
          : `<ol class="progress" id="progressDots" aria-hidden="true">${dots}</ol>`}
        <span class="muted small">${answered} answered${skipped ? `, ${skipped} skipped` : ""}</span>
        ${state.deadlineMs !== null ? `<span class="timer" id="timerPill" role="timer" aria-live="off"></span>` : ""}
        <span class="q-strip__event">${escapeHtml(state.eventTitle)} <span class="mono">${escapeHtml(state.joinCode)}</span></span>
      </div>

      <div class="q-layout">
        ${QuestView.questionCard(q, h)}

        <section class="card" aria-label="Your answer">
          ${QuestView.answerCard(q, state.answers[q.id], { locked, h })}

          ${committedPanel(q)}
          ${state.notice ? `<p class="notice notice--warning q-change" role="status">${escapeHtml(state.notice)}</p>` : ""}
          ${modeHint()}

          <p class="notice q-status" id="submitStatus" role="status" hidden></p>

          <div class="q-nav">${navButtons(q, isLast)}</div>
        </section>
      </div>
    `;

    updateTimerPill();
    scheduleSync();
    bindProgressDots();

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
      // Under in order, questions not reached yet are not held here at all.
      const given = ACTIVE_BANK.filter(item => state.committed[item.id] || state.answers[item.id] !== undefined).length;
      const missing = state.questionCount - given;
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

  // The parts of a result the status poll reports.
  function totalsSignature(result) {
    return JSON.stringify(result ? [result.score, result.max, result.pending || 0, Boolean(result.markedSoFar), Boolean(result.breakdownReleased)] : null);
  }

  // AI-scored answers are marked after submit, so the total can rise (or,
  // before release, the results can be released). Check back a few times
  // while any are still pending: the status poll first, and the full
  // attempt only when its totals have changed.
  function pollWhileMarking(result, { auto, polls = 0 }) {
    stopMarkingPoll();

    if (!result || !result.pending || polls >= MARKING_POLLS) {
      return;
    }

    const attemptId = state.attemptId;
    const shown = totalsSignature(result);

    state.markingTimerId = setTimeout(async () => {
      state.markingTimerId = null;

      try {
        const status = await api(`/api/attempts/${attemptId}?fields=status`, { method: "GET", headers: attemptHeaders() });

        if (state.attemptId !== attemptId || status.attempt.status !== "submitted") {
          return;
        }

        if (totalsSignature(status.result) === shown) {
          pollWhileMarking(result, { auto, polls: polls + 1 });
          return;
        }

        const view = await api(`/api/attempts/${attemptId}`, { method: "GET", headers: attemptHeaders() });

        if (state.attemptId === attemptId && view.attempt.status === "submitted") {
          renderResults(view, { auto, polls: polls + 1 });
        }
      } catch (_error) {
        if (state.attemptId === attemptId) {
          pollWhileMarking(result, { auto, polls: polls + 1 });
        }
      }
    }, MARKING_POLL_SECONDS * 1000);
  }

  function renderResults(payload, { auto = false, polls = 0 } = {}) {
    stopTimer();
    state.inAttempt = false;
    stopProgressPoll();

    const result = payload.result || { score: 0, max: 0, breakdownReleased: false };
    const pendingCount = result.pending || 0;
    // Before release the server sends only the instantly marked part of the
    // total (policy.studentTotal), so it is labelled as such.
    const markedSoFar = Boolean(result.markedSoFar);
    const pendingWords = `${pendingCount} answer${pendingCount === 1 ? "" : "s"} still being marked`;
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

    // The questions this attempt was sent, for their figures: a released
    // breakdown offers a structured visual again beside the key.
    const heldQuestions = new Map((payload.questions || ACTIVE_BANK || []).map(question => [question.id, question]));

    const rows = perQ ? perQ.map(item => {
      const meta = [item.level, item.topic, item.qType].filter(Boolean).join(" · ");
      const held = heldQuestions.get(item.id);
      const kind = held && held.visual ? Visuals.get(held.visual.kind) : null;
      const recall = kind && kind.structured
        ? `<details class="qv-recall"><summary>Show the figure</summary>${Visuals.figure(held.visual, { id: `qv-r-${item.id}` })}</details>`
        : "";

      return `
        <li class="result-row">
          <div>
            <strong>${escapeHtml(item.title || item.id)}</strong>
            ${meta ? `<div class="result-meta">${escapeHtml(meta)}</div>` : ""}
            ${resultLines(item)}
            ${recall}
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
            <div class="stat"><dt>${markedSoFar ? "Marked so far" : "Score"}</dt><dd>${result.score} / ${result.max}${markedSoFar ? ` <span class="stat__note">(${pendingWords})</span>` : ""}</dd></div>
            <div class="stat"><dt>Time</dt><dd>${mins ? `${mins} min` : "Not known"}</dd></div>
            <div class="stat"><dt>Answered</dt><dd>${Object.keys(state.answers).length}</dd></div>
          </dl>

          <div class="stack stack--tight mt-m">
            ${auto ? `<p class="notice notice--warning">Time ran out, so your answers were sent automatically.</p>` : ""}
            ${late ? `<p class="notice notice--warning">This came in after the time limit, so your teacher will see it marked late.</p>` : ""}
            ${markedSoFar
              ? `<p class="notice">Your written answers are marked separately. Your full score appears when your teacher releases the results.</p>`
              : pendingCount ? `<p class="notice">${pendingCount} written answer${pendingCount === 1 ? " is" : "s are"} still being marked, so your score may go up. This page checks again every ${MARKING_POLL_SECONDS} seconds.</p><span class="skeleton skeleton--line skeleton--short" role="status" aria-label="Checking for marks"></span>` : ""}
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
          <button id="restartBtn" class="btn btn--secondary">Join another challenge</button>
        </div>
      </div>
    `;

    pollWhileMarking(result, { auto, polls });

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
      state.joinEvent = null;
      state.eventTitle = "";
      state.attemptId = null;
      state.attemptToken = null;
      state.deadlineMs = null;
      state.deadlineAt = null;
      state.submitting = false;
      state.i = 0;
      state.questionCount = 0;
      state.answers = {};
      state.startedAt = null;
      state.feedbackMode = "release";
      state.navigationMode = "free";
      state.committed = {};
      clearSavedAttempt();
      renderStart();
    });
  }

  // The same card index.html ships, so the page never goes blank between
  // the HTML and the first real screen.
  const LOADING_CARD = `
    <div class="card" role="status" aria-label="Loading">
      <span class="skeleton skeleton--title" aria-hidden="true"></span>
      <span class="skeleton skeleton--line" aria-hidden="true"></span>
      <span class="skeleton skeleton--line skeleton--short" aria-hidden="true"></span>
      <span class="skeleton skeleton--block" aria-hidden="true"></span>
    </div>
  `;

  async function boot() {
    if (!screen.querySelector(".skeleton")) {
      screen.innerHTML = LOADING_CARD;
    }

    try {
      await Promise.all([Types.load(), Visuals.load()]);
    } catch (_error) {
      screen.innerHTML = `<section class="card"><p class="notice notice--critical">Could not load the challenge. Check your connection and refresh.</p></section>`;
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
