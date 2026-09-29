// Draws one question the way a student sees it, so the student page and the
// teacher's review pane share the markup. Needs type-registry.js and
// visuals/visuals.js loaded first; the pages hand in h ({ escapeHtml }),
// the helpers the type renderers take too.
//
//   questionCard(q, h)                the card with the title, points, tags,
//                                     prompt, visual, art and code
//   answerCard(q, response, opts)     the answer area built by the type's
//                                     renderInput; opts = { locked, h }

(function () {
  function questionCard(q, h) {
    const renderer = window.CTQuestTypes.get(q.type);
    const Visuals = window.CTQuestVisuals;
    const { escapeHtml } = h;

    const meta = [q.level, q.topic, q.qType].filter(Boolean)
      .map(label => `<span class="concept-tag">${escapeHtml(label)}</span>`).join("");

    const art = q.art ? `<pre>${escapeHtml(q.art)}</pre>` : "";
    // A visual (ADR 0007): a figure after the prompt, or a small scene
    // floated beside it; whatever follows the prompt starts below the scene.
    const figure = q.visual ? Visuals.figure(q.visual, { id: `qv-${q.id}` }) : "";
    const aside = Boolean(figure) && Visuals.placement(q.visual) === "aside";
    const code = !q.code ? "" : renderer.renderCode
      ? renderer.renderCode(q.code, h, q)
      : `<p class="code-label">${escapeHtml(q.code.language)}</p><pre><code>${escapeHtml(q.code.source)}</code></pre>`;

    return `
        <section class="card" aria-labelledby="questionTitle">
          <div class="q-head">
            <h2 id="questionTitle">${escapeHtml(q.title)}</h2>
            <span class="q-points">${q.points} point${q.points === 1 ? "" : "s"}</span>
          </div>
          <div class="concept-tags q-meta">${meta}</div>

          ${aside ? figure : ""}
          <p class="prompt-text">${escapeHtml(q.prompt)}</p>
          ${aside ? `<div class="qv-clear"></div>` : figure}
          ${art}
          ${code}
          ${renderer.renderContext ? renderer.renderContext(q, h) : ""}
        </section>`;
  }

  function answerCard(q, response, { locked, h }) {
    const renderer = window.CTQuestTypes.get(q.type);

    return `<div id="answerArea">${locked
      ? `<fieldset class="answer-locked" disabled data-locked>${renderer.renderInput(q, response, h)}</fieldset>`
      : renderer.renderInput(q, response, h)}</div>`;
  }

  window.CTQuestView = { questionCard, answerCard };
})();
