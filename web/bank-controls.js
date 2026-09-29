// Teacher controls for one question bank entry: flag, comments, the metadata
// editor (admins), and retire / restore (admins). A review pane mounts it:
//
//   QuestBankControls.render(entry, slotEl, { refresh, isAdmin })
//
// `entry` is one item of GET /api/question-bank. render replaces the slot's
// contents and is safe to call again. After each successful change it calls
// refresh(), which is expected to reload the bank and call render again; an
// open, unsaved form does not survive that. Does its own API calls, reading
// the token admin.js stores (same key).
(function () {
  const TOKEN_KEY = "ct-quest-token";
  const APPLIES_NOTE = "Changes apply to events created from now on; existing events and results are unchanged.";
  const DIFFICULTIES = [1, 2, 3, 4, 5];

  // The editable fields, in display order.
  const FIELDS = [
    { key: "level", label: "Level" },
    { key: "points", label: "Points" },
    { key: "topic", label: "Topic" },
    { key: "qType", label: "Question type tag" },
    { key: "difficulty", label: "Difficulty (1 to 5)" },
    { key: "ontology", label: "Ontology nodes" },
    { key: "outcomes", label: "Learning outcomes" },
    { key: "details", label: "Teacher note" }
  ];

  // Reference data is loaded once and shared by every render.
  let referenceData = null;
  // Where focus goes after the next render, per question: { id, key }.
  let pendingFocus = null;

  async function api(path, options) {
    const headers = new Headers({ "Content-Type": "application/json" });
    const token = localStorage.getItem(TOKEN_KEY);

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload.error || "Request failed.");
      error.status = response.status;
      error.errors = Array.isArray(payload.errors) ? payload.errors : [];
      throw error;
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

  function formatTime(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? String(iso || "") : date.toLocaleString();
  }

  function loadReference() {
    if (!referenceData) {
      referenceData = Promise.all([api("/api/catalog"), api("/api/ontology"), api("/api/outcomes")])
        .then(([catalog, ontology, outcomes]) => ({
          levels: catalog.levels,
          nodes: ontology.nodes,
          outcomes: outcomes.outcomes
        }))
        .catch(error => {
          referenceData = null;
          throw error;
        });
    }

    return referenceData;
  }

  function sameList(a, b) {
    return a.length === b.length && a.every(item => b.includes(item));
  }

  function showValue(key, value) {
    if (Array.isArray(value)) {
      return value.length ? value.join(", ") : "none";
    }

    if (value === null || value === undefined || value === "") {
      return "none";
    }

    return String(value);
  }

  function isOverridden(entry, key) {
    return Boolean(entry.overlay) && entry.overlay[key] !== null && entry.overlay[key] !== undefined;
  }

  // ---------- Markup ----------

  function flagSection(entry) {
    const overlay = entry.overlay;
    const flagged = Boolean(overlay && overlay.flagged);

    if (flagged) {
      return `
        <section class="bc-section" aria-labelledby="bcFlagHeading">
          <h3 class="bc-heading" id="bcFlagHeading">Flag <span class="tag status status--warning">Flagged</span></h3>
          <p class="bc-meta">Flagged by ${escapeHtml(overlay.flaggedBy || "a teacher")}${overlay.flaggedAt ? ` on ${escapeHtml(formatTime(overlay.flaggedAt))}` : ""}.</p>
          ${overlay.flagNote ? `<p class="bc-quote">${escapeHtml(overlay.flagNote)}</p>` : `<p class="bc-meta">No note was left.</p>`}
          <div class="bc-actions">
            <button type="button" class="btn btn--secondary btn--sm" data-bc-unflag data-bc-key="flag">Remove flag</button>
          </div>
          <p class="error-text" role="alert" data-bc-error="flag" hidden></p>
        </section>`;
    }

    return `
      <section class="bc-section" aria-labelledby="bcFlagHeading">
        <h3 class="bc-heading" id="bcFlagHeading">Flag</h3>
        <p class="bc-meta">Flag a question that needs another look. Any teacher can flag or unflag.</p>
        <div class="field">
          <label for="bcFlagNote">Note (optional)</label>
          <textarea id="bcFlagNote" rows="2" maxlength="1000" data-bc-flag-note></textarea>
        </div>
        <div class="bc-actions">
          <button type="button" class="btn btn--secondary btn--sm" data-bc-flag data-bc-key="flag">Flag this question</button>
        </div>
        <p class="error-text" role="alert" data-bc-error="flag" hidden></p>
      </section>`;
  }

  function commentSection(entry) {
    const comments = entry.comments || [];
    const list = comments.length
      ? `<ul class="bc-comments">${comments.map(comment => `
          <li class="bc-comment">
            <p class="bc-meta"><strong>${escapeHtml(comment.author || "A teacher")}</strong> · ${escapeHtml(formatTime(comment.created_at))}</p>
            <p class="bc-comment__body">${escapeHtml(comment.body)}</p>
          </li>`).join("")}</ul>`
      : `<p class="bc-meta">No comments yet.</p>`;

    return `
      <section class="bc-section" aria-labelledby="bcCommentHeading">
        <h3 class="bc-heading" id="bcCommentHeading">Comments <span class="bc-count">${comments.length}</span></h3>
        ${list}
        <div class="field">
          <label for="bcCommentBody">Add a comment</label>
          <textarea id="bcCommentBody" rows="3" maxlength="2000" data-bc-comment-body></textarea>
          <p class="bc-meta">Comments are kept and cannot be edited or deleted.</p>
        </div>
        <div class="bc-actions">
          <button type="button" class="btn btn--secondary btn--sm" data-bc-comment data-bc-key="comment">Post comment</button>
        </div>
        <p class="error-text" role="alert" data-bc-error="comment" hidden></p>
      </section>`;
  }

  function staleWarning(entry) {
    const stale = entry.overlay && entry.overlay.stale;

    if (!stale || !stale.length) {
      return "";
    }

    return `
      <div class="bc-warning" role="alert">
        <p><strong>Warning: an edit on this question no longer applies.</strong> The question in the content files changed, so a saved edit is now invalid and is being ignored:</p>
        <ul>${stale.map(message => `<li>${escapeHtml(message)}</li>`).join("")}</ul>
        <p>Clearing the bad field with "Reset to original" fixes it.</p>
      </div>`;
  }

  function checklist(key, options, selected, labelText) {
    return `
      <div class="bc-picker" data-bc-picker="${key}">
        <label class="bc-picker__filter-label" for="bcFilter-${key}">Filter ${escapeHtml(labelText.toLowerCase())}</label>
        <input type="search" id="bcFilter-${key}" data-bc-filter="${key}" autocomplete="off">
        <div class="bc-picker__list" role="group" aria-label="${escapeHtml(labelText)}">
          ${options.map(option => `
            <label class="bc-check" data-bc-option-text="${escapeHtml((option.id + " " + option.text).toLowerCase())}">
              <input type="checkbox" name="${key}" value="${escapeHtml(option.id)}" ${selected.includes(option.id) ? "checked" : ""}>
              <span>${escapeHtml(option.text)} <span class="bc-check__id">${escapeHtml(option.id)}</span></span>
            </label>`).join("")}
        </div>
      </div>`;
  }

  function fieldInput(field, entry, reference) {
    const value = entry.teacher[field.key];
    const id = `bcField-${field.key}`;

    switch (field.key) {
      case "level": {
        const levels = reference.levels.slice();

        if (value && !levels.some(level => level.id === value)) {
          levels.unshift({ id: value, label: value });
        }

        return `<select id="${id}" data-bc-input="level">${levels.map(level => `<option value="${escapeHtml(level.id)}" ${level.id === value ? "selected" : ""}>${escapeHtml(level.label ? `${level.label} (${level.id})` : level.id)}</option>`).join("")}</select>`;
      }
      case "points":
        return `<input type="number" id="${id}" data-bc-input="points" min="0" max="100" step="1" value="${escapeHtml(value ?? "")}">`;
      case "topic":
      case "qType":
        return `<input type="text" id="${id}" data-bc-input="${field.key}" maxlength="100" value="${escapeHtml(value ?? "")}">`;
      case "difficulty":
        return `<select id="${id}" data-bc-input="difficulty">${DIFFICULTIES.map(n => `<option value="${n}" ${n === value ? "selected" : ""}>${n}</option>`).join("")}</select>`;
      case "details":
        return `<textarea id="${id}" data-bc-input="details" rows="4" maxlength="5000">${escapeHtml(value ?? "")}</textarea>`;
      default:
        return "";
    }
  }

  function readValue(form, key) {
    if (key === "ontology" || key === "outcomes") {
      return Array.from(form.querySelectorAll(`input[name="${key}"]:checked`)).map(input => input.value);
    }

    const input = form.querySelector(`[data-bc-input="${key}"]`);

    if (key === "points" || key === "difficulty") {
      return input.value === "" ? undefined : Number(input.value);
    }

    return input.value;
  }

  function valuesEqual(key, a, b) {
    return Array.isArray(a) ? sameList(a, b || []) : a === b;
  }

  function editorRows(entry, reference) {
    const nodeText = new Map(reference.nodes.map(node => [node.id, node.label]));
    const outcomeText = new Map(reference.outcomes.map(outcome => [outcome.id, outcome.statement]));

    return FIELDS.map(field => {
      const overridden = isOverridden(entry, field.key);
      const original = entry.original ? entry.original[field.key] : undefined;
      const inputId = `bcField-${field.key}`;
      let control;

      if (field.key === "ontology") {
        control = checklist("ontology", reference.nodes.map(node => ({ id: node.id, text: node.label })), entry.teacher.ontology || [], field.label);
      } else if (field.key === "outcomes") {
        control = checklist("outcomes", reference.outcomes.map(outcome => ({ id: outcome.id, text: outcome.statement })), entry.teacher.outcomes || [], field.label);
      } else {
        control = fieldInput(field, entry, reference);
      }

      const listLike = field.key === "ontology" || field.key === "outcomes";
      const originalText = listLike
        ? (original || []).map(id => (field.key === "ontology" ? nodeText : outcomeText).get(id) || id).join("; ") || "none"
        : showValue(field.key, original);

      return `
        <div class="bc-row ${overridden ? "bc-row--overridden" : ""}" data-bc-row="${field.key}">
          <div class="bc-row__head">
            ${listLike ? `<span class="bc-row__label" id="bcLabel-${field.key}">${escapeHtml(field.label)}</span>` : `<label class="bc-row__label" for="${inputId}">${escapeHtml(field.label)}</label>`}
            ${overridden ? `<span class="tag">Edited</span>` : ""}
          </div>
          <div class="bc-row__control">${control}</div>
          <p class="bc-row__original"><span class="bc-row__original-label">Original:</span> ${escapeHtml(originalText)}</p>
          ${overridden ? `<button type="button" class="btn btn--ghost btn--sm" data-bc-reset="${field.key}" data-bc-key="reset-${field.key}" aria-label="Reset ${escapeHtml(field.label)} to original">Reset to original</button>` : ""}
        </div>`;
    }).join("");
  }

  function readOnlyRows(entry, reference) {
    const nodeText = new Map(reference ? reference.nodes.map(node => [node.id, node.label]) : []);
    const outcomeText = new Map(reference ? reference.outcomes.map(outcome => [outcome.id, outcome.statement]) : []);

    return `<dl class="bc-readonly">${FIELDS.map(field => {
      const value = entry.teacher[field.key];
      const original = entry.original ? entry.original[field.key] : undefined;
      const overridden = isOverridden(entry, field.key);
      const text = value => {
        if (field.key === "ontology") {
          return showValue(field.key, (value || []).map(id => nodeText.get(id) || id));
        }

        if (field.key === "outcomes") {
          return showValue(field.key, (value || []).map(id => outcomeText.get(id) || id));
        }

        return showValue(field.key, value);
      };

      return `
        <div class="bc-readonly__item">
          <dt>${escapeHtml(field.label)} ${overridden ? `<span class="tag">Edited</span>` : ""}</dt>
          <dd>${escapeHtml(text(value))}${overridden ? `<span class="bc-row__original"><span class="bc-row__original-label">Original:</span> ${escapeHtml(text(original))}</span>` : ""}</dd>
        </div>`;
    }).join("")}</dl>`;
  }

  function retireSection(entry) {
    const retired = Boolean(entry.overlay && entry.overlay.retired);

    if (retired) {
      const overlay = entry.overlay;
      return `
        <section class="bc-section" aria-labelledby="bcRetireHeading">
          <h3 class="bc-heading" id="bcRetireHeading">Retirement <span class="tag status status--neutral">Retired</span></h3>
          <p class="bc-meta">Retired by ${escapeHtml(overlay.retiredBy || "an admin")}${overlay.retiredAt ? ` on ${escapeHtml(formatTime(overlay.retiredAt))}` : ""}. It stays in the bank but is left out of all new events.</p>
          <div class="bc-actions">
            <button type="button" class="btn btn--secondary btn--sm" data-bc-restore data-bc-key="retire">Restore question</button>
          </div>
          <p class="error-text" role="alert" data-bc-error="retire" hidden></p>
        </section>`;
    }

    return `
      <section class="bc-section" aria-labelledby="bcRetireHeading">
        <h3 class="bc-heading" id="bcRetireHeading">Retirement</h3>
        <div class="bc-actions">
          <button type="button" class="btn btn--destructive btn--sm" data-bc-retire-open data-bc-key="retire" aria-expanded="false" aria-controls="bcRetireConfirm">Retire question…</button>
        </div>
        <div class="bc-confirm" id="bcRetireConfirm" role="group" aria-labelledby="bcRetireConfirmText" hidden>
          <p id="bcRetireConfirmText">A retired question stays in the bank, but is excluded from all new events. Existing events keep it. You can restore it at any time.</p>
          <div class="bc-actions">
            <button type="button" class="btn btn--destructive btn--sm" data-bc-retire>Confirm retire</button>
            <button type="button" class="btn btn--ghost btn--sm" data-bc-retire-cancel>Cancel</button>
          </div>
        </div>
        <p class="error-text" role="alert" data-bc-error="retire" hidden></p>
      </section>`;
  }

  function metadataShell(isAdmin) {
    return `
      <section class="bc-section" aria-labelledby="bcMetaHeading">
        <h3 class="bc-heading" id="bcMetaHeading">Question details</h3>
        <p class="bc-note">${escapeHtml(APPLIES_NOTE)}</p>
        ${isAdmin ? "" : `<p class="bc-meta">Only admins can edit these values.</p>`}
        <div data-bc-meta><p class="bc-meta">Loading…</p></div>
      </section>`;
  }

  // ---------- Behaviour ----------

  function showError(slot, name, message, list) {
    const target = slot.querySelector(`[data-bc-error="${name}"]`);

    if (!target) {
      return;
    }

    if (!message) {
      target.hidden = true;
      target.textContent = "";
      return;
    }

    target.hidden = false;
    target.innerHTML = list && list.length
      ? `The server refused these changes:<ul>${list.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : escapeHtml(message);
  }

  function fillMetadata(entry, slot, isAdmin, done) {
    const host = slot.querySelector("[data-bc-meta]");

    loadReference().then(reference => {
      if (!host.isConnected) {
        return;
      }

      if (!isAdmin) {
        host.innerHTML = readOnlyRows(entry, reference);
        return;
      }

      host.innerHTML = `
        <form class="bc-form" novalidate data-bc-form>
          ${editorRows(entry, reference)}
          <div class="bc-actions">
            <button type="submit" class="btn btn--accent btn--sm" data-bc-key="save">Save changes</button>
          </div>
          <p class="error-text" role="alert" data-bc-error="save" hidden></p>
        </form>`;
      done();
    }).catch(() => {
      if (host.isConnected) {
        host.innerHTML = isAdmin
          ? `<p class="error-text" role="alert">The pickers could not be loaded, so the details cannot be edited right now.</p>`
          : readOnlyRows(entry, null);
      }
    });
  }

  function render(entry, slotEl, options = {}) {
    if (!slotEl || !entry) {
      return;
    }

    const isAdmin = Boolean(options.isAdmin);
    const id = entry.teacher.id;
    const busy = new Set();

    slotEl.classList.add("bc");
    slotEl.innerHTML = `
      ${staleWarning(entry)}
      ${flagSection(entry)}
      ${commentSection(entry)}
      ${metadataShell(isAdmin)}
      ${isAdmin ? retireSection(entry) : ""}`;

    const url = suffix => `/api/question-bank/${encodeURIComponent(id)}${suffix}`;

    // Runs one mutation, then hands over to the pane's refresh.
    async function run(name, button, request) {
      if (busy.has(name)) {
        return;
      }

      busy.add(name);
      button.disabled = true;
      showError(slotEl, name, "");

      try {
        await request();
        pendingFocus = { id, key: button.dataset.bcKey || name };

        if (typeof options.refresh === "function") {
          await options.refresh();
        } else {
          slotEl.dispatchEvent(new CustomEvent("bc:changed", { bubbles: true }));
        }
      } catch (error) {
        showError(slotEl, name, error.message, name === "save" ? error.errors : []);
        button.disabled = false;
        button.focus();
      } finally {
        busy.delete(name);
      }
    }

    const on = (selector, handler) => {
      const element = slotEl.querySelector(selector);

      if (element) {
        element.addEventListener("click", handler);
      }
    };

    on("[data-bc-flag]", event => {
      const note = slotEl.querySelector("[data-bc-flag-note]").value.trim();
      run("flag", event.currentTarget, () => api(url("/flag"), { method: "POST", body: JSON.stringify({ note }) }));
    });

    on("[data-bc-unflag]", event => {
      run("flag", event.currentTarget, () => api(url("/flag"), { method: "DELETE", body: JSON.stringify({}) }));
    });

    on("[data-bc-comment]", event => {
      const field = slotEl.querySelector("[data-bc-comment-body]");
      const body = field.value.trim();

      if (!body) {
        showError(slotEl, "comment", "Write a comment first.");
        field.focus();
        return;
      }

      run("comment", event.currentTarget, () => api(url("/comments"), { method: "POST", body: JSON.stringify({ body }) }));
    });

    if (isAdmin) {
      const confirmBox = slotEl.querySelector("#bcRetireConfirm");
      const openButton = slotEl.querySelector("[data-bc-retire-open]");

      on("[data-bc-retire-open]", () => {
        confirmBox.hidden = false;
        openButton.setAttribute("aria-expanded", "true");
        confirmBox.querySelector("[data-bc-retire]").focus();
      });

      on("[data-bc-retire-cancel]", () => {
        confirmBox.hidden = true;
        openButton.setAttribute("aria-expanded", "false");
        openButton.focus();
      });

      on("[data-bc-retire]", event => {
        run("retire", event.currentTarget, () => api(url("/retire"), { method: "POST", body: JSON.stringify({}) }));
      });

      on("[data-bc-restore]", event => {
        run("retire", event.currentTarget, () => api(url("/restore"), { method: "POST", body: JSON.stringify({}) }));
      });
    }

    let formReady = false;

    function applyFocus() {
      if (pendingFocus && pendingFocus.id === id) {
        const target = slotEl.querySelector(`[data-bc-key="${pendingFocus.key}"]`);

        // The edit form loads after the first call, so a save or reset button
        // is not there yet: wait for the second call rather than falling back.
        if (!target && !formReady && /^(save|reset)/.test(pendingFocus.key)) {
          return;
        }

        (target || slotEl.querySelector("[data-bc-key]") || { focus() {} }).focus();
        pendingFocus = null;
      }
    }

    applyFocus();
    formReady = true;

    fillMetadata(entry, slotEl, isAdmin, () => {
      const form = slotEl.querySelector("[data-bc-form]");

      form.addEventListener("input", event => {
        if (event.target.matches("[data-bc-filter]")) {
          const key = event.target.dataset.bcFilter;
          const term = event.target.value.trim().toLowerCase();

          form.querySelectorAll(`[data-bc-picker="${key}"] [data-bc-option-text]`).forEach(option => {
            option.hidden = Boolean(term) && !option.dataset.bcOptionText.includes(term);
          });
        }
      });

      form.addEventListener("keydown", event => {
        // Enter in the filter box should filter, not submit the form.
        if (event.key === "Enter" && event.target.matches("[data-bc-filter]")) {
          event.preventDefault();
        }
      });

      form.addEventListener("click", event => {
        const button = event.target.closest("[data-bc-reset]");

        if (button) {
          const key = button.dataset.bcReset;
          run("save", button, () => api(url(""), { method: "PATCH", body: JSON.stringify({ [key]: null }) }));
        }
      });

      form.addEventListener("submit", event => {
        event.preventDefault();

        const patch = {};
        const blank = [];

        FIELDS.forEach(field => {
          const value = readValue(form, field.key);

          if (value === undefined) {
            blank.push(field.label);
          } else if (!valuesEqual(field.key, value, entry.teacher[field.key] ?? "")) {
            patch[field.key] = value;
          }
        });

        if (blank.length) {
          showError(slotEl, "save", `${blank.join(" and ")} needs a number. Use "Reset to original" to clear an edit.`);
          return;
        }

        if (!Object.keys(patch).length) {
          showError(slotEl, "save", "Nothing has changed.");
          return;
        }

        run("save", form.querySelector("button[type=submit]"), () => api(url(""), { method: "PATCH", body: JSON.stringify(patch) }));
      });

      applyFocus();
    });
  }

  window.QuestBankControls = { render };
})();
