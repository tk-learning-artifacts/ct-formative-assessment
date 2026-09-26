(function () {
  const screen = document.getElementById("screen");
  const themeToggle = document.getElementById("themeToggle");
  const root = document.documentElement;
  const THEME_KEY = "ct-quest-theme";
  const TOKEN_KEY = "ct-quest-token";

  const state = {
    token: localStorage.getItem(TOKEN_KEY),
    user: null,
    events: [],
    selectedEventId: null,
    results: null
  };

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

  function renderDashboard() {
    const eventCards = state.events.map(event => `
      <button class="event-card ${state.selectedEventId === event.id ? "event-card--active" : ""}" data-event-id="${event.id}">
        <div class="event-card__top">
          <strong>${escapeHtml(event.title)}</strong>
          <span class="pill">${escapeHtml(event.join_code)}</span>
        </div>
        <div class="event-card__meta">
          <span>${escapeHtml(event.selection_mode === "FILTER" ? event.filter_summary || "Custom filter" : event.selection_mode)}</span>
          <span>${event.duration_minutes ? `${event.duration_minutes} min` : "No timer"}</span>
          <span>${event.attempt_count} attempts</span>
        </div>
      </button>
    `).join("");

    const resultsBlock = state.results
      ? `
        <div class="results-breakdown" style="margin-top:18px">
          <p class="panel-label">Submissions</p>
          <h3>${escapeHtml(state.results.event.title)} (${escapeHtml(state.results.event.join_code)})</h3>
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
                    <span>${escapeHtml(attempt.status)}</span>
                    <span>${attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString() : "Not submitted"}</span>
                  </div>
                </div>
              `).join("")
              : `<p class="muted">No submissions yet for this event.</p>`
            }
          </div>
        </div>
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

      // Core options use the legacy selectionMode; RGSynapse options send the
      // v2 filter shape that the Phase 2 picker will build in full.
      const selection = selectionMode.startsWith("RGS:")
        ? { filter: { audiences: ["rgsynapse"], levels: selectionMode.slice(4).split(",") } }
        : { selectionMode };

      try {
        await api("/api/events", {
          method: "POST",
          body: JSON.stringify({
            title,
            ...selection,
            joinCode,
            durationMinutes: durationMinutes ? Number(durationMinutes) : null,
            startAt: startAt || null,
            endAt: endAt || null
          })
        });

        await loadDashboard();
      } catch (error) {
        alert(error.message);
      }
    });

    Array.from(screen.querySelectorAll("[data-event-id]")).forEach(button => {
      button.addEventListener("click", async () => {
        state.selectedEventId = Number(button.getAttribute("data-event-id"));
        await loadResults(state.selectedEventId);
      });
    });
  }

  async function loadResults(eventId) {
    try {
      state.results = await api(`/api/events/${eventId}/results`);
      renderDashboard();
    } catch (error) {
      alert(error.message);
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
      }
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
