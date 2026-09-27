// Visual kind "table": a small table of short cells (ADR 0007). Worked
// examples (input and output), steps in time order across two actors.
//
//   columns     2 to 4 column headings, each at most 24 characters
//   rows        1 to 8 rows, each a list with one string per column (at
//               most 40 characters; "" leaves a cell empty)
//   rowHeader   optional; true makes the first column a row heading
//
// It is drawn as an HTML table rather than SVG, so it is its own text
// equivalent: screen readers read it cell by cell, and it reflows on a
// phone. describe() still gives it in words, for the checks at boot.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../visuals.js"));
  } else {
    root.CTQuestVisuals.register(factory(root.CTQuestVisuals));
  }
})(typeof self !== "undefined" ? self : this, function (V) {
  function validate(visual) {
    const errors = [];

    if (!Array.isArray(visual.columns) || visual.columns.length < 2 || visual.columns.length > 4) {
      return ["columns must be a list of 2 to 4 headings"];
    }
    visual.columns.forEach((heading, i) => errors.push(...V.checkText(heading, `column ${i + 1}`, { max: 24 })));

    if (!Array.isArray(visual.rows) || visual.rows.length < 1 || visual.rows.length > 8) {
      return errors.concat("rows must be a list of 1 to 8 rows");
    }

    visual.rows.forEach((row, r) => {
      if (!Array.isArray(row) || row.length !== visual.columns.length) {
        errors.push(`row ${r + 1} must have ${visual.columns.length} cells`);
        return;
      }
      row.forEach((cell, c) => {
        if (cell !== "") {
          errors.push(...V.checkText(cell, `row ${r + 1} cell ${c + 1}`, { max: 40 }));
        }
      });
      if (row.every(cell => cell === "")) {
        errors.push(`row ${r + 1} is empty`);
      }
    });

    if (visual.rowHeader !== undefined && typeof visual.rowHeader !== "boolean") {
      errors.push("rowHeader must be true or false");
    }

    return errors;
  }

  function label(visual) {
    return `A table with ${visual.rows.length} row${visual.rows.length === 1 ? "" : "s"}`;
  }

  function describe(visual) {
    const rows = visual.rows.map((row, r) => {
      const cells = row.map((cell, c) => (cell === "" ? null : `${visual.columns[c]}: ${cell}`)).filter(Boolean);
      return `Row ${r + 1}: ${cells.join("; ")}.`;
    });
    return `${label(visual)} and the columns ${V.listWords(visual.columns)}. ${rows.join(" ")}`;
  }

  function render(visual) {
    const head = visual.columns.map(heading => `<th scope="col">${V.esc(heading)}</th>`).join("");
    const body = visual.rows.map(row => `<tr>${row.map((cell, c) => (c === 0 && visual.rowHeader
      ? `<th scope="row">${V.esc(cell)}</th>`
      : `<td>${V.esc(cell)}</td>`)).join("")}</tr>`).join("");
    return `<table class="qv-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  return {
    kind: "table",
    structured: true,
    textual: true,
    purposes: ["information", "reading-load"],
    fields: ["columns", "rows", "rowHeader"],
    validate,
    label,
    describe,
    render
  };
});
