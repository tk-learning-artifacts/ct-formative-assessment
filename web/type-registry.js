// Registry of question-type renderers for the student page. Each file in
// web/types/ registers one type; this file loads them all (the list comes from
// GET /api/web-types, which the server derives from that folder), so adding a
// type needs no edit to index.html or app.js.
//
// A renderer is registered with CTQuestTypes.register(type, {
//   renderInput(question, response, h)   HTML for answering; h = { escapeHtml }
//   readResponse(container, question)    the response to submit; undefined
//                                        leaves the saved answer as it is,
//                                        null clears it
//   describeResponse(response, h)        text for the results breakdown
//   renderCode(code, h)                  optional; HTML for the question's
//                                        code block instead of the default
//   renderContext(question, h)           optional; HTML shown under the
//                                        question (instructions, target
//                                        output), not on the answer side
//   ready                                optional; a promise for anything
//                                        the renderer loads itself (blocks
//                                        loads its engine); load() waits
//                                        for it
// })

(function () {
  const renderers = {};

  function register(type, renderer) {
    ["renderInput", "readResponse", "describeResponse"].forEach(key => {
      if (typeof renderer[key] !== "function") {
        throw new Error(`Renderer for "${type}" is missing ${key}()`);
      }
    });

    renderers[type] = renderer;
  }

  function get(type) {
    const renderer = renderers[type];

    if (!renderer) {
      throw new Error(`This page cannot show "${type}" questions yet.`);
    }

    return renderer;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function load() {
    const response = await fetch("/api/web-types");
    const payload = await response.json();

    for (const file of payload.renderers || []) {
      await loadScript(`/${file}`);
    }

    await Promise.all(Object.values(renderers).map(renderer => renderer.ready).filter(Boolean));
  }

  window.CTQuestTypes = { register, get, load };
})();
