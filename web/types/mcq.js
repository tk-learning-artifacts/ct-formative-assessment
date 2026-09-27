// Multiple choice renderer. The response is the chosen option's index.

(function () {
  window.CTQuestTypes.register("mcq", {
    renderInput(question, response, h) {
      const options = question.options.map((option, idx) => `
        <label class="opt">
          <input type="radio" name="opt" value="${idx}" ${response === idx ? "checked" : ""} />
          <div class="opt__text">${h.escapeHtml(option)}</div>
        </label>
      `).join("");

      return `
        <p class="panel-label">Choose One Answer</p>
        <div class="options">${options}</div>
      `;
    },

    readResponse(container) {
      const selected = container.querySelector('input[name="opt"]:checked');
      return selected ? Number(selected.value) : undefined;
    },

    // Stored responses look like { index, text }.
    describeResponse(response) {
      return response && typeof response === "object" && response.text !== undefined ? String(response.text) : "No answer";
    }
  });
})();
