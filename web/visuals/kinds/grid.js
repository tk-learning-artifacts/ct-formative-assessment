// Visual kind "grid": a maze of square cells (ADR 0007).
//
//   rows   list of equal-length strings, one per row, top first, using
//          "." open floor, "#" wall, "S" start, "T" target
//          (exactly one S and one T; 1 to 10 rows and columns)
//
// Walls are dark; S and T carry their letter, so no state is colour only.
// Columns are lettered and rows numbered around the edge, which is also how
// the description names cells.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../visuals.js"));
  } else {
    root.CTQuestVisuals.register(factory(root.CTQuestVisuals));
  }
})(typeof self !== "undefined" ? self : this, function (V) {
  const CELL_WORDS = { ".": "open", "#": "wall", S: "S (start)", T: "T (target)" };
  const MAX = 10;

  function columnName(x) {
    return String.fromCharCode(65 + x);
  }

  function validate(visual) {
    const rows = visual.rows;

    if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX) {
      return [`rows must be a list of 1 to ${MAX} strings`];
    }

    const errors = [];
    const width = typeof rows[0] === "string" ? rows[0].length : 0;

    if (width < 1 || width > MAX) {
      errors.push(`rows must be 1 to ${MAX} cells wide`);
    }

    rows.forEach((row, y) => {
      if (typeof row !== "string" || row.length !== width) {
        errors.push(`row ${y + 1} must be a string ${width} cells wide`);
      } else if (!/^[.#ST]+$/.test(row)) {
        errors.push(`row ${y + 1} may only use . # S T`);
      }
    });

    const all = rows.join("");
    ["S", "T"].forEach(letter => {
      const count = all.split(letter).length - 1;
      if (count !== 1) {
        errors.push(`needs exactly one ${letter}, found ${count}`);
      }
    });

    return errors;
  }

  function label(visual) {
    return `A grid ${visual.rows[0].length} columns wide and ${visual.rows.length} rows high`;
  }

  function describe(visual) {
    const rows = visual.rows;
    const lines = rows.map((row, y) => `Row ${y + 1}: ${Array.from(row).map((cell, x) => `${columnName(x)} ${CELL_WORDS[cell]}`).join(", ")}.`);
    return `${label(visual)}, columns lettered A to ${columnName(rows[0].length - 1)} from the left and rows numbered from the top. ${lines.join(" ")}`;
  }

  function render(visual, ctx) {
    const rows = visual.rows;
    const cols = rows[0].length;
    const cell = Math.min(48, Math.floor(300 / Math.max(cols, rows.length)));
    const pad = 22;
    const width = pad + cols * cell + 4;
    const height = pad + rows.length * cell + 4;
    const parts = [V.svgOpen(ctx, width, height, label(visual), "qv-grid")];

    for (let x = 0; x < cols; x += 1) {
      parts.push(`<text class="qv-axis" x="${pad + x * cell + cell / 2}" y="${pad - 7}" text-anchor="middle">${columnName(x)}</text>`);
    }

    rows.forEach((row, y) => {
      parts.push(`<text class="qv-axis" x="${pad - 8}" y="${pad + y * cell + cell / 2 + 5}" text-anchor="middle">${y + 1}</text>`);

      Array.from(row).forEach((value, x) => {
        const px = pad + x * cell;
        const py = pad + y * cell;
        const tone = value === "#" ? "qv-cell--wall" : value === "." ? "qv-cell--open" : "qv-cell--mark";
        parts.push(`<rect class="qv-cell ${tone}" x="${px}" y="${py}" width="${cell}" height="${cell}" />`);

        if (value === "S" || value === "T") {
          parts.push(`<text class="qv-cell__letter" x="${px + cell / 2}" y="${py + cell / 2 + 7}" text-anchor="middle">${value}</text>`);
        }
      });
    });

    parts.push("</svg>");
    return parts.join("");
  }

  return {
    kind: "grid",
    structured: true,
    purposes: ["information", "reading-load"],
    fields: ["rows"],
    validate,
    label,
    describe,
    render
  };
});
