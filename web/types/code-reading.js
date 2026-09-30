// Code reading renderer. The student reads a snippet (line numbers, and
// dotted words with a glossary note on tap, hover or Enter), picks the
// description of what it does, and answers the follow-up if there is one:
// another choice, or which line of the code they would change. The response
// is { choice, followUp }, either part possibly missing.

(function () {
  // Words and symbols that look like identifiers only match whole, so the
  // term "in" is not found inside "print".
  function termPattern(term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const start = /^\w/.test(term) ? "(?<![\\w])" : "";
    const end = /\w$/.test(term) ? "(?![\\w])" : "";
    return new RegExp(`${start}${escaped}${end}`, "g");
  }

  // [{ from, to, index }] for every glossary term in one line of code,
  // longest terms first and never overlapping.
  function termMatches(line, glossary) {
    const found = [];
    const order = glossary.map((entry, index) => ({ entry, index })).sort((a, b) => b.entry.term.length - a.entry.term.length);

    order.forEach(({ entry, index }) => {
      for (const match of line.matchAll(termPattern(entry.term))) {
        const from = match.index;
        const to = from + entry.term.length;
        if (!found.some(other => from < other.to && to > other.from)) {
          found.push({ from, to, index });
        }
      }
    });

    return found.sort((a, b) => a.from - b.from);
  }

  function noteId(question) {
    return `cr-note-${String(question.id).replace(/[^A-Za-z0-9_-]/g, "")}`;
  }

  // Only the first mark of each term is a tab stop, so a term used on every
  // line does not add a stop per line.
  function renderLine(line, question, h, tabbed) {
    const glossary = question.glossary || [];
    let html = "";
    let at = 0;

    termMatches(line, glossary).forEach(({ from, to, index }) => {
      const entry = glossary[index];
      html += h.escapeHtml(line.slice(at, from));
      html += `<button type="button" class="cr-term" data-cr-term="${index}" data-cr-note="${h.escapeHtml(entry.note)}"
        data-cr-label="${h.escapeHtml(entry.term)}" aria-controls="${noteId(question)}" aria-expanded="false"
        tabindex="${tabbed.has(index) ? "-1" : "0"}">${h.escapeHtml(line.slice(from, to))}</button>`;
      tabbed.add(index);
      at = to;
    });

    return html + h.escapeHtml(line.slice(at));
  }

  // The note under the code shows one term at a time. A click (or tap, or
  // Enter) pins it; a mouse hover shows it until the pointer leaves, unless
  // it was pinned. Escape closes it. `note` is the live region, which stays
  // in the page so screen readers announce what appears in it.
  function showNote(button, pinned) {
    const note = document.getElementById(button.getAttribute("aria-controls"));
    if (!note) {
      return;
    }

    note.querySelector("[data-cr-note-term]").textContent = button.getAttribute("data-cr-label");
    note.querySelector("[data-cr-note-text]").textContent = button.getAttribute("data-cr-note");
    note.querySelector(".cr-note").hidden = false;
    note.dataset.term = button.getAttribute("data-cr-term");
    note.dataset.pinned = pinned ? "true" : "";

    document.querySelectorAll(`[aria-controls="${note.id}"]`).forEach(other => {
      other.setAttribute("aria-expanded", String(pinned && other.getAttribute("data-cr-term") === note.dataset.term));
    });
  }

  function isOpen(note) {
    return !note.querySelector(".cr-note").hidden;
  }

  function hideNote(note) {
    note.querySelector(".cr-note").hidden = true;
    note.dataset.term = "";
    note.dataset.pinned = "";
    document.querySelectorAll(`[aria-controls="${note.id}"]`).forEach(other => other.setAttribute("aria-expanded", "false"));
  }

  document.addEventListener("click", event => {
    const button = event.target.closest && event.target.closest(".cr-term");
    if (!button) {
      return;
    }

    const note = document.getElementById(button.getAttribute("aria-controls"));
    if (note && isOpen(note) && note.dataset.pinned && note.dataset.term === button.getAttribute("data-cr-term")) {
      hideNote(note);
    } else {
      showNote(button, true);
    }
  });

  document.addEventListener("pointerover", event => {
    const button = event.pointerType === "mouse" && event.target.closest && event.target.closest(".cr-term");
    const note = button && document.getElementById(button.getAttribute("aria-controls"));
    if (note && !note.dataset.pinned) {
      showNote(button, false);
    }
  });

  document.addEventListener("pointerout", event => {
    const button = event.pointerType === "mouse" && event.target.closest && event.target.closest(".cr-term");
    const note = button && document.getElementById(button.getAttribute("aria-controls"));
    if (note && !note.dataset.pinned && !button.contains(event.relatedTarget)) {
      hideNote(note);
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") {
      return;
    }
    document.querySelectorAll(".cr-note-region").forEach(note => {
      if (isOpen(note)) {
        hideNote(note);
      }
    });
  });

  function radio(name, value, checked, body) {
    return `
      <label class="opt">
        <input type="radio" name="${name}" value="${value}" ${checked ? "checked" : ""} />
        <div class="opt__text">${body}</div>
      </label>
    `;
  }

  // The follow-up's options: its own, or every non-blank line of the code.
  function followUpOptions(question, response, h) {
    const followUp = question.followUp;
    const chosen = response && response.followUp;

    if (followUp.kind === "choice") {
      return followUp.options.map((option, idx) => radio("crFollowUp", idx, chosen === idx, h.escapeHtml(option))).join("");
    }

    return String(question.code.source).split("\n")
      .map((text, i) => ({ line: i + 1, text }))
      .filter(entry => entry.text.trim())
      .map(entry => radio("crFollowUp", entry.line, chosen === entry.line,
        `<span class="cr-line-pick"><span class="cr-line-pick__no">Line ${entry.line}</span> <code>${h.escapeHtml(entry.text.trim())}</code></span>`))
      .join("");
  }

  function pointsLabel(points) {
    return `${points} point${points === 1 ? "" : "s"}`;
  }

  window.CTQuestTypes.register("code-reading", {
    // Replaces the plain code block. The numbers are hidden from screen
    // readers and from copying, as in the code-trace renderer.
    renderCode(code, h, question) {
      const q = question || { id: "code", glossary: [] };
      const tabbed = new Set();
      const lines = String(code.source).split("\n").map((line, i) => (
        `<span class="ct-line"><span class="ct-line__no" aria-hidden="true">${i + 1}</span><span class="ct-line__text">${renderLine(line, q, h, tabbed) || " "}</span></span>`
      )).join("");
      const hasGlossary = Boolean(q.glossary && q.glossary.length);

      return `
        <p class="code-label">${h.escapeHtml(code.language)}</p>
        <pre class="ct-code cr-code"><code>${lines}</code></pre>
        ${hasGlossary ? `
          <p class="cr-hint">Tap a dotted word to see what it means.</p>
          <div class="cr-note-region" id="${noteId(q)}" aria-live="polite">
            <p class="cr-note" hidden><strong class="mono" data-cr-note-term></strong> <span data-cr-note-text></span></p>
          </div>
        ` : ""}
      `;
    },

    renderInput(question, response, h) {
      const choice = response && response.choice;
      const followUp = question.followUp;
      const describePoints = question.points - (followUp ? followUp.points : 0);
      const descriptions = question.options.map((option, idx) => radio("crChoice", idx, choice === idx, h.escapeHtml(option))).join("");

      return `
        <fieldset class="cr-part">
          <legend class="answer-label">What does the code do?${followUp ? ` <span class="cr-part__points">${pointsLabel(describePoints)}</span>` : ""}</legend>
          <div class="options">${descriptions}</div>
        </fieldset>
        ${followUp ? `
          <fieldset class="cr-part">
            <legend class="answer-label">${h.escapeHtml(followUp.prompt)} <span class="cr-part__points">${pointsLabel(followUp.points)}</span></legend>
            <div class="options">${followUpOptions(question, response, h)}</div>
          </fieldset>
        ` : ""}
      `;
    },

    // undefined (nothing picked yet) leaves the saved answer as it is, as for
    // multiple choice; radios cannot be cleared once picked.
    readResponse(container) {
      const choice = container.querySelector('input[name="crChoice"]:checked');
      const followUp = container.querySelector('input[name="crFollowUp"]:checked');

      if (!choice && !followUp) {
        return undefined;
      }

      const response = {};
      if (choice) {
        response.choice = Number(choice.value);
      }
      if (followUp) {
        response.followUp = Number(followUp.value);
      }
      return response;
    },

    // Only one of the two parts picked: the review page lists it as partly answered.
    isPartial(question, response) {
      if (!question.followUp || !response || typeof response !== "object") return false;
      return (response.choice === undefined) !== (response.followUp === undefined);
    },

    // Stored responses look like { choice: { index, text }, followUp:
    // { index, text } or { line, text } }. The leading line break puts each
    // part on its own line under the label.
    describeResponse(response) {
      if (!response || typeof response !== "object" || (!response.choice && !response.followUp)) {
        return "No answer";
      }

      const parts = [`What it does: ${response.choice ? response.choice.text : "no answer"}`];

      if (response.followUp !== undefined) {
        const followUp = response.followUp;
        parts.push(`Follow-up: ${!followUp ? "no answer" : followUp.line ? `line ${followUp.line} (${String(followUp.text).trim()})` : followUp.text}`);
      }

      return `\n${parts.join("\n")}`;
    }
  });
})();
