// Question visuals (ADR 0007): the registry of visual kinds, the fields every
// visual shares, the student projection and the <figure> markup. The browser
// loads this file as a global (CTQuestVisuals); the server require()s it,
// with the same kind files, to validate content at boot and to project a
// question for students. Nothing here touches the DOM except load(), so the
// markup can be built and checked under Node too.
//
// A kind is one file in web/visuals/kinds/, registered with
// CTQuestVisuals.register({
//   kind                       the name used in content ("grid", "graph", ...)
//   structured                 true for data drawn as SVG or HTML; false for
//                              an image file (illustrations)
//   purposes                   the purposes it may declare (ADR 0007 §1)
//   fields                     its own keys, all public
//   privateFields              optional; keys kept from students (provenance)
//   placement                  optional; "aside" floats it beside the title,
//                              the default "inline" puts it after the prompt
//   validate(visual)           -> array of error strings
//   textual                    optional; true when render() is HTML text (a
//                              table) that needs no separate description
//   describe(visual)           -> the long text description (structured kinds)
//   label(visual)              -> a short name for the figure ("A 4 by 4 grid")
//   render(visual, ctx)        -> markup; ctx = { id, esc } for unique ids
// })

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CTQuestVisuals = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  const PURPOSES = ["information", "reading-load", "context"];
  const COMMON_FIELDS = ["kind", "purpose", "caption"];
  // What a student receives besides the kind's own fields. purpose says why
  // the author drew it, which a student has no use for.
  const PUBLIC_COMMON = ["kind", "caption"];
  const CAPTION_MAX = 120;

  const kinds = {};

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function register(def) {
    ["kind", "purposes", "fields", "validate", "render", "label"].forEach(key => {
      if (def[key] === undefined) {
        throw new Error(`Visual kind "${def.kind}" is missing "${key}"`);
      }
    });
    if (def.structured && typeof def.describe !== "function") {
      throw new Error(`Visual kind "${def.kind}" is structured, so it needs describe()`);
    }
    kinds[def.kind] = def;
    return def;
  }

  function get(kind) {
    return Object.prototype.hasOwnProperty.call(kinds, kind) ? kinds[kind] : null;
  }

  function list() {
    return Object.keys(kinds).sort();
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // Helpers the kind files share for their own checks.
  function checkText(value, label, { max = 40, required = true } = {}) {
    if (value === undefined && !required) {
      return [];
    }
    if (typeof value !== "string" || (required && !value.trim())) {
      return [`${label} must be a non-empty string`];
    }
    if (value.length > max) {
      return [`${label} is longer than ${max} characters`];
    }
    if (/[\r\n]/.test(value)) {
      return [`${label} must be one line`];
    }
    return [];
  }

  function checkInt(value, label, min, max) {
    return Number.isInteger(value) && value >= min && value <= max ? [] : [`${label} must be a whole number from ${min} to ${max}`];
  }

  function checkKeys(object, allowed, label) {
    if (!isPlainObject(object)) {
      return [`${label} must be an object`];
    }
    return Object.keys(object).filter(key => !allowed.includes(key)).map(key => `${label} has unknown key "${key}"`);
  }

  // Everything that does not need the file system: the common fields, the
  // kind's own checks, and a description a screen reader can use.
  function validate(visual) {
    if (!isPlainObject(visual)) {
      return ["visual must be an object"];
    }

    const def = get(visual.kind);

    if (!def) {
      return [`visual has unknown kind "${visual.kind}" (known: ${list().join(", ")})`];
    }

    const errors = [];

    if (!PURPOSES.includes(visual.purpose)) {
      errors.push(`visual purpose must be one of ${PURPOSES.join(", ")}`);
    } else if (!def.purposes.includes(visual.purpose)) {
      errors.push(`a ${def.kind} visual cannot have purpose "${visual.purpose}" (allowed: ${def.purposes.join(", ")})`);
    }

    if (visual.caption !== undefined) {
      errors.push(...checkText(visual.caption, "visual caption", { max: CAPTION_MAX }));
    }

    errors.push(...checkKeys(visual, COMMON_FIELDS.concat(def.fields, def.privateFields || []), "visual"));

    if (errors.length) {
      return errors;
    }

    const own = def.validate(visual);

    if (own.length) {
      return own.map(message => `visual (${def.kind}) ${message}`);
    }

    if (def.structured && !String(def.describe(visual) || "").trim()) {
      return [`visual (${def.kind}) has no description; describe() came out empty`];
    }

    return [];
  }

  // The visual as a student receives it: an allowlist of the common public
  // fields and the kind's own fields. Provenance and purpose stay behind.
  function toPublic(visual) {
    const def = visual && get(visual.kind);

    if (!def) {
      return undefined;
    }

    const safe = {};
    PUBLIC_COMMON.concat(def.fields).forEach(field => {
      if (visual[field] !== undefined) {
        safe[field] = JSON.parse(JSON.stringify(visual[field]));
      }
    });
    return safe;
  }

  function describe(visual) {
    const def = visual && get(visual.kind);
    if (!def) {
      return "";
    }
    return def.structured ? def.describe(visual) : String(visual.alt || "");
  }

  function placement(visual) {
    const def = visual && get(visual.kind);
    return (def && def.placement) || "inline";
  }

  // A <figure> for one visual. id must be unique on the page; it prefixes
  // every id inside (SVG markers, the description the SVG points at).
  function figure(visual, { id = "qv" } = {}) {
    const def = visual && get(visual.kind);

    if (!def) {
      return "";
    }

    const safeId = String(id).replace(/[^A-Za-z0-9_-]/g, "-");
    const ctx = { id: safeId, esc, labelId: `${safeId}-label`, descId: `${safeId}-desc` };
    const caption = visual.caption ? `<figcaption class="qv__caption">${esc(visual.caption)}</figcaption>` : "";

    // An image carries its alt; a table is its own text equivalent. Neither
    // needs the "Describe the picture" words.
    if (!def.structured || def.textual) {
      return `<figure class="qv qv--${esc(def.kind)}">${def.render(visual, ctx)}${caption}</figure>`;
    }

    return `
      <figure class="qv qv--${esc(def.kind)}">
        <div class="qv__frame">${def.render(visual, ctx)}</div>
        ${caption}
        <details class="qv__describe">
          <summary>Describe the picture</summary>
          <p id="${ctx.descId}">${esc(def.describe(visual))}</p>
        </details>
      </figure>
    `;
  }

  // Browser only: loads every kind file the server lists.
  async function load() {
    const response = await fetch("/api/web-visuals");
    const payload = await response.json();

    for (const file of payload.kinds || []) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `/${file}`;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Could not load ${file}`));
        document.head.appendChild(script);
      });
    }
  }

  // Wraps text into lines of at most maxChars, breaking at spaces.
  function wrap(text, maxChars) {
    const lines = [];
    let line = "";

    String(text).split(/\s+/).filter(Boolean).forEach(word => {
      if (!line) {
        line = word;
      } else if ((line + " " + word).length <= maxChars) {
        line += " " + word;
      } else {
        lines.push(line);
        line = word;
      }
    });

    if (line) {
      lines.push(line);
    }

    return lines;
  }

  // The opening <svg> tag every structured kind uses: scales to its box,
  // announced as one image with a short label and the long description.
  function svgOpen(ctx, width, height, label, className) {
    return `<svg class="qv__svg ${className || ""}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="${ctx.labelId}" aria-describedby="${ctx.descId}"><title id="${ctx.labelId}">${esc(label)}</title>`;
  }

  // An arrowhead marker, unique to one figure.
  function arrowMarker(ctx) {
    return `<defs><marker id="${ctx.id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="qv-arrowhead" d="M0,0 L10,5 L0,10 Z" /></marker></defs>`;
  }

  function listWords(items) {
    if (items.length <= 1) {
      return items.join("");
    }
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  }

  return {
    PURPOSES,
    COMMON_FIELDS,
    PUBLIC_COMMON,
    register,
    get,
    list,
    validate,
    toPublic,
    describe,
    placement,
    figure,
    load,
    esc,
    wrap,
    svgOpen,
    arrowMarker,
    listWords,
    checkText,
    checkInt,
    checkKeys,
    isPlainObject
  };
});
