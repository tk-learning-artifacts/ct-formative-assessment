// Open response renderer: the student types a short answer, which the server
// scores later against a rubric (the rubric never reaches this page). The
// response is the typed text; it is stored as { text }.

(function () {
  const DEFAULT_MAX_CHARS = 1000;

  window.CTQuestTypes.register("open-response-ai", {
    renderInput(question, response, h) {
      const maxChars = question.responseMaxChars || DEFAULT_MAX_CHARS;
      const text = typeof response === "string" ? response : "";

      return `
        <label class="panel-label" for="openResponse">Your Answer</label>
        <textarea id="openResponse" class="open-response" rows="7" maxlength="${maxChars}"
          placeholder="Write your answer in a few sentences." autocomplete="off" spellcheck="true">${h.escapeHtml(text)}</textarea>
        <p class="muted open-response__hint">Up to ${maxChars} characters. This answer is marked after you submit, so your score may go up later. Don't include your name or other personal details.</p>
      `;
    },

    readResponse(container) {
      const input = container.querySelector("#openResponse");
      return input && input.value.trim() ? input.value : undefined;
    },

    // Stored responses look like { text }.
    describeResponse(response) {
      return response && typeof response === "object" && typeof response.text === "string" ? response.text : "No answer";
    }
  });
})();
