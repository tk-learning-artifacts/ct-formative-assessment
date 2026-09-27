// Code trace renderer. The student reads the program (shown with line
// numbers in the prompt card) and types its output. The response is the text
// they typed.

(function () {
  // Every keystroke counts as a change, so the answer is saved for a refresh
  // and caught by an auto-submit even while the box still has focus.
  document.addEventListener("input", event => {
    if (event.target.matches && event.target.matches("[data-code-trace-output]")) {
      event.target.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  window.CTQuestTypes.register("code-trace", {
    // Replaces the plain code block. The numbers are hidden from screen
    // readers and from copying, so a copied program still runs.
    renderCode(code, h) {
      const lines = String(code.source).split("\n").map((line, i) => (
        `<span class="ct-line"><span class="ct-line__no" aria-hidden="true">${i + 1}</span><span class="ct-line__text">${h.escapeHtml(line) || " "}</span></span>`
      )).join("");

      return `
        <p class="code-label">${h.escapeHtml(code.language)}</p>
        <pre class="ct-code"><code>${lines}</code></pre>
      `;
    },

    renderInput(question, response, h) {
      const text = typeof response === "string" ? response : "";

      return `
        <p class="panel-label"><label for="codeTraceOutput">Type the exact output</label></p>
        <textarea id="codeTraceOutput" class="ct-output" data-code-trace-output rows="6"
          spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"
          aria-describedby="codeTraceHint">${h.escapeHtml(text)}</textarea>
        <p class="muted ct-hint" id="codeTraceHint">One printed line per line. Spaces at the end of a line do not matter.</p>
      `;
    },

    // null clears the answer when the box is emptied.
    readResponse(container) {
      const box = container.querySelector("[data-code-trace-output]");

      if (!box) {
        return undefined;
      }

      return box.value.trim() ? box.value : null;
    },

    // Stored responses look like { text }. The leading line break puts the
    // output under its label in the breakdown.
    describeResponse(response) {
      return response && typeof response.text === "string" ? `\n${response.text}` : "No answer";
    }
  });
})();
