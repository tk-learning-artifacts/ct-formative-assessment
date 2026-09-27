// Parsons renderer. Every line starts in "Lines to use", in the shuffled
// order the server sent. The student builds "Your program" from them, leaving
// out lines that belong nowhere. Each line has buttons (add, up, down,
// remove), so the whole task works from the keyboard; dragging a line by its
// handle is an extra, and uses pointer events so it works with touch too.
// The response is the list of line ids in "Your program", top to bottom.
//
// The question's HTML is rebuilt by the page on every render, so behaviour is
// attached once here, by delegation on the document. After each move the
// widget fires a bubbling "change", which the page listens for to save the
// answer.

(function () {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Indentation is part of each line's text; the visible dots under the
  // leading spaces make it easy to see on a phone.
  // i and count place a line in the program, so its first up and last down
  // buttons start disabled; lines in the pool leave them out.
  function lineHtml(line, i = -1, count = 0) {
    const label = escapeHtml(line.text.trim());

    return `
      <li class="pa-line" data-line-id="${escapeHtml(line.id)}">
        <span class="pa-handle" aria-hidden="true" title="Drag to move">&#8942;&#8942;</span>
        <code class="pa-text">${escapeHtml(line.text)}</code>
        <span class="pa-controls">
          <button type="button" class="btn btn--secondary pa-btn pa-add" data-pa-action="add" aria-label="Add to program: ${label}">Add</button>
          <button type="button" class="btn btn--secondary pa-btn pa-up" data-pa-action="up" aria-label="Move up: ${label}" ${i === 0 ? "disabled" : ""}>&#8593;</button>
          <button type="button" class="btn btn--secondary pa-btn pa-down" data-pa-action="down" aria-label="Move down: ${label}" ${i === count - 1 ? "disabled" : ""}>&#8595;</button>
          <button type="button" class="btn btn--secondary pa-btn pa-remove" data-pa-action="remove" aria-label="Remove from program: ${label}">&#10005;</button>
        </span>
      </li>
    `;
  }

  function parts(widget) {
    return {
      program: widget.querySelector("[data-pa-program]"),
      pool: widget.querySelector("[data-pa-pool]"),
      status: widget.querySelector("[data-pa-status]")
    };
  }

  // Disables buttons that would do nothing, and shows the placeholders for
  // empty lists.
  function refresh(widget) {
    const { program, pool } = parts(widget);
    const programLines = Array.from(program.children).filter(el => el.classList.contains("pa-line"));

    programLines.forEach((line, i) => {
      line.querySelector(".pa-up").disabled = i === 0;
      line.querySelector(".pa-down").disabled = i === programLines.length - 1;
    });

    widget.querySelector("[data-pa-program-empty]").hidden = programLines.length > 0;
    widget.querySelector("[data-pa-pool-empty]").hidden = pool.querySelector(".pa-line") !== null;
  }

  function announce(widget, message) {
    const { status } = parts(widget);
    status.textContent = message;
  }

  function changed(widget) {
    refresh(widget);
    widget.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function positionText(widget, line) {
    const { program } = parts(widget);
    const lines = Array.from(program.querySelectorAll(".pa-line"));
    return `line ${lines.indexOf(line) + 1} of ${lines.length}`;
  }

  // Keeps focus on the moved line, on the button that makes sense next.
  function focusButton(line, preferred) {
    const order = [preferred, "up", "down", "remove", "add"];
    for (const action of order) {
      const button = line.querySelector(`[data-pa-action="${action}"]`);
      if (button && !button.disabled && button.offsetParent !== null) {
        button.focus();
        return;
      }
    }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest && event.target.closest("[data-pa-action]");
    const widget = button && button.closest("[data-parsons]");

    if (!widget) {
      return;
    }

    const line = button.closest(".pa-line");
    const { program, pool } = parts(widget);
    const action = button.getAttribute("data-pa-action");
    const text = line.querySelector(".pa-text").textContent.trim();

    if (action === "add") {
      program.appendChild(line);
    } else if (action === "remove") {
      pool.appendChild(line);
    } else if (action === "up" && line.previousElementSibling && line.previousElementSibling.classList.contains("pa-line")) {
      program.insertBefore(line, line.previousElementSibling);
    } else if (action === "down" && line.nextElementSibling) {
      program.insertBefore(line.nextElementSibling, line);
    }

    changed(widget);
    announce(widget, action === "remove" ? `Removed ${text}` : `${text}: ${positionText(widget, line)}`);
    focusButton(line, action === "add" ? "remove" : action === "remove" ? "add" : action);
  });

  // Dragging by the handle. The line follows the pointer between and within
  // both lists; letting go saves the new order.
  let drag = null;

  function dropTarget(widget, x, y) {
    const under = document.elementFromPoint(x, y);
    const list = under && under.closest("[data-pa-program], [data-pa-pool]");
    return list && widget.contains(list) ? { list, line: under.closest(".pa-line") } : null;
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    event.preventDefault();
    const target = dropTarget(drag.widget, event.clientX, event.clientY);

    if (!target || target.line === drag.line) {
      return;
    }

    if (!target.line) {
      target.list.appendChild(drag.line);
      return;
    }

    const box = target.line.getBoundingClientRect();
    const before = event.clientY < box.top + box.height / 2;
    target.list.insertBefore(drag.line, before ? target.line : target.line.nextElementSibling);
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    const { widget, line } = drag;
    line.classList.remove("pa-line--dragging");
    widget.classList.remove("pa--dragging");
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", endDrag);
    document.removeEventListener("pointercancel", endDrag);
    drag = null;

    changed(widget);
    const inProgram = line.parentElement === parts(widget).program;
    announce(widget, `${line.querySelector(".pa-text").textContent.trim()}: ${inProgram ? positionText(widget, line) : "not used"}`);
  }

  document.addEventListener("pointerdown", event => {
    const handle = event.target.closest && event.target.closest(".pa-handle");
    const widget = handle && handle.closest("[data-parsons]");

    if (!widget || drag || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    event.preventDefault();
    const line = handle.closest(".pa-line");
    drag = { widget, line, pointerId: event.pointerId };
    line.classList.add("pa-line--dragging");
    widget.classList.add("pa--dragging");
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
  });

  window.CTQuestTypes.register("parsons", {
    // response: the line ids of the student's program, in order.
    renderInput(question, response, h) {
      const byId = new Map(question.lines.map(line => [line.id, line]));
      const chosen = Array.isArray(response) ? response.filter(id => byId.has(id)) : [];
      const used = new Set(chosen);
      const programLines = chosen.map(id => byId.get(id));
      const poolLines = question.lines.filter(line => !used.has(line.id));
      const language = question.language ? h.escapeHtml(question.language) : "code";

      return `
        <div class="pa" data-parsons>
          <p class="answer-label">Build the program</p>

          <p class="code-label" id="paProgramLabel">Your program (${language})</p>
          <ol class="pa-list pa-program" data-pa-program aria-labelledby="paProgramLabel">
            ${programLines.map((line, i) => lineHtml(line, i, programLines.length)).join("")}
          </ol>
          <p class="pa-empty" data-pa-program-empty ${programLines.length ? "hidden" : ""}>No lines yet.</p>

          <p class="code-label" id="paPoolLabel">Lines to use</p>
          <ul class="pa-list pa-pool" data-pa-pool aria-labelledby="paPoolLabel">
            ${poolLines.map(line => lineHtml(line)).join("")}
          </ul>
          <p class="pa-empty" data-pa-pool-empty ${poolLines.length ? "hidden" : ""}>Every line is in your program.</p>

          <p class="pa-status" data-pa-status aria-live="polite"></p>
        </div>
      `;
    },

    // The instructions and target output sit with the question, so the
    // answer side holds only the program and the lines to use.
    renderContext(question, h) {
      const target = question.expectedOutput
        ? `<p class="code-label">It should print</p><pre class="pa-target">${h.escapeHtml(question.expectedOutput)}</pre>`
        : "";

      return `
        <p class="pa-help">Press Add to put a line in your program, or drag it by the handle. Leave out lines you don't need. The indentation is already in each line.</p>
        ${target}
      `;
    },

    // null clears the answer when the program is emptied.
    readResponse(container) {
      const program = container.querySelector("[data-pa-program]");

      if (!program) {
        return undefined;
      }

      const ids = Array.from(program.querySelectorAll(".pa-line")).map(line => line.getAttribute("data-line-id"));
      return ids.length ? ids : null;
    },

    // Stored responses look like { lines: [{ id, text }] }. The leading line
    // break puts the program under its label in the breakdown.
    describeResponse(response) {
      return response && Array.isArray(response.lines) && response.lines.length
        ? `\n${response.lines.map(line => line.text).join("\n")}`
        : "No answer";
    }
  });
})();
