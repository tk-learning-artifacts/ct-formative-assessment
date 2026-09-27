// Visual kind "illustration": a generated or drawn picture that sets the
// scene (ADR 0007 §2). Context only: nothing in it may be needed to answer,
// so it can never have purpose "information" or "reading-load".
//
//   src      a file in web/visuals/img/, named after the question id in
//            lower case with an optional "-n": "p5-01.webp"
//   alt      what the picture shows, at most 250 characters
//   source   teacher-only provenance, never sent to students:
//            { generator, prompt, date, reviewed }
//
// The server checks the file exists, is a WebP of at most 100 KB and
// carries no metadata; this file checks the fields.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../visuals.js"));
  } else {
    root.CTQuestVisuals.register(factory(root.CTQuestVisuals));
  }
})(typeof self !== "undefined" ? self : this, function (V) {
  const GENERATORS = ["agy", "codex", "hand"];

  function validate(visual) {
    const errors = [];

    if (typeof visual.src !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*\.webp$/.test(visual.src)) {
      errors.push("src must be a lower-case .webp file name such as p5-01.webp");
    }
    if (typeof visual.alt !== "string" || !visual.alt.trim()) {
      errors.push("needs alt text");
    } else {
      errors.push(...V.checkText(visual.alt, "alt", { max: 250 }));
    }

    const source = visual.source;
    const keyErrors = V.checkKeys(source, ["generator", "prompt", "date", "reviewed"], "source");

    if (keyErrors.length) {
      return errors.concat(keyErrors);
    }
    if (!GENERATORS.includes(source.generator)) {
      errors.push(`source.generator must be one of ${GENERATORS.join(", ")}`);
    }
    if (typeof source.prompt !== "string" || !source.prompt.trim()) {
      errors.push("source.prompt must record the prompt used");
    }
    if (typeof source.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(source.date)) {
      errors.push("source.date must be a date such as 2026-09-27");
    }
    if (source.reviewed !== true) {
      errors.push("source.reviewed must be true: every illustration is looked at before it ships");
    }

    return errors;
  }

  function label(visual) {
    return visual.alt;
  }

  function render(visual) {
    return `<img class="qv-illustration" src="/visuals/img/${V.esc(visual.src)}" alt="${V.esc(visual.alt)}" loading="lazy" decoding="async" />`;
  }

  return {
    kind: "illustration",
    structured: false,
    placement: "aside",
    purposes: ["context"],
    fields: ["src", "alt"],
    privateFields: ["source"],
    validate,
    label,
    render
  };
});
