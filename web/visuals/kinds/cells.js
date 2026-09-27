// Visual kind "cells": one to four labelled rows of boxes (ADR 0007). A row
// to sort, a repeating pattern, a strip of tiles, the letters of a string,
// a list with its indexes.
//
//   rows          list of { label?, cells }; label at most 12 characters
//   cells         1 to 10 items, each one of:
//                   "text"                     up to 6 characters in a box
//                   "…"                        "and so on", drawn without a box
//                   { text?, shape?, fill? }   shape "circle" | "square" |
//                                              "triangle"; fill "light" | "dark"
//   numbered      optional; true numbers the boxes above the first row
//   numberFrom    optional; 0 or 1 (the default), where numbering starts
//   fillWords     optional; { light, dark }, the words the description uses
//                 for the two fills (default "light" and "dark")
//
// Dark boxes differ from light ones by luminance (about 7:1), so they read
// in greyscale; shapes are told apart by outline, never by colour.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../visuals.js"));
  } else {
    root.CTQuestVisuals.register(factory(root.CTQuestVisuals));
  }
})(typeof self !== "undefined" ? self : this, function (V) {
  const SHAPES = ["circle", "square", "triangle"];
  const FILLS = ["light", "dark"];
  const GAP = "…";

  function normalise(item) {
    if (item === GAP) {
      return { gap: true };
    }
    if (typeof item === "string") {
      return { text: item };
    }
    return item;
  }

  function validateItem(item, where) {
    if (item === GAP) {
      return [];
    }
    if (typeof item === "string") {
      return V.checkText(item, where, { max: 6 });
    }

    const errors = V.checkKeys(item, ["text", "shape", "fill"], where);

    if (errors.length) {
      return errors;
    }
    if (item.text === undefined && item.shape === undefined && item.fill === undefined) {
      errors.push(`${where} needs text, a shape or a fill`);
    }
    if (item.text !== undefined) {
      errors.push(...V.checkText(item.text, `${where} text`, { max: 6 }));
    }
    if (item.shape !== undefined && !SHAPES.includes(item.shape)) {
      errors.push(`${where} shape must be one of ${SHAPES.join(", ")}`);
    }
    if (item.fill !== undefined && !FILLS.includes(item.fill)) {
      errors.push(`${where} fill must be one of ${FILLS.join(", ")}`);
    }
    if (item.text !== undefined && item.shape !== undefined) {
      errors.push(`${where} cannot have both text and a shape`);
    }
    return errors;
  }

  function validate(visual) {
    const errors = [];

    if (!Array.isArray(visual.rows) || visual.rows.length < 1 || visual.rows.length > 4) {
      return ["rows must be a list of 1 to 4 rows"];
    }

    visual.rows.forEach((row, r) => {
      const where = `row ${r + 1}`;
      const keyErrors = V.checkKeys(row, ["label", "cells"], where);

      if (keyErrors.length) {
        errors.push(...keyErrors);
        return;
      }
      if (row.label !== undefined) {
        errors.push(...V.checkText(row.label, `${where} label`, { max: 12 }));
      }
      if (!Array.isArray(row.cells) || row.cells.length < 1 || row.cells.length > 10) {
        errors.push(`${where} needs 1 to 10 cells`);
        return;
      }
      row.cells.forEach((item, c) => errors.push(...validateItem(item, `${where} cell ${c + 1}`)));
    });

    if (visual.numbered !== undefined && typeof visual.numbered !== "boolean") {
      errors.push("numbered must be true or false");
    }
    if (visual.numberFrom !== undefined && visual.numberFrom !== 0 && visual.numberFrom !== 1) {
      errors.push("numberFrom must be 0 or 1");
    }
    if (visual.fillWords !== undefined) {
      const keyErrors = V.checkKeys(visual.fillWords, FILLS, "fillWords");
      errors.push(...keyErrors);
      if (!keyErrors.length) {
        FILLS.forEach(fill => errors.push(...V.checkText(visual.fillWords[fill], `fillWords.${fill}`, { max: 20 })));
      }
    }

    return errors;
  }

  function itemWords(item, fillWords) {
    if (item.gap) {
      return "and so on";
    }
    const words = [];
    if (item.fill) {
      words.push(fillWords[item.fill]);
    }
    if (item.shape) {
      words.push(item.shape);
    }
    if (item.text !== undefined) {
      words.push(item.fill ? `with ${item.text}` : item.text);
    }
    return words.join(" ");
  }

  function boxCount(row) {
    return row.cells.filter(item => item !== GAP).length;
  }

  function label(visual) {
    if (visual.rows.length === 1) {
      const count = boxCount(visual.rows[0]);
      return `A row of ${count} box${count === 1 ? "" : "es"}`;
    }
    return `${visual.rows.length} rows of boxes`;
  }

  function describe(visual) {
    const fillWords = { light: "light", dark: "dark", ...(visual.fillWords || {}) };
    const from = visual.numberFrom === 0 ? 0 : 1;
    const parts = [`${label(visual)}.`];

    if (visual.numbered) {
      const longest = Math.max(...visual.rows.map(boxCount));
      parts.push(`The boxes are numbered ${from} to ${from + longest - 1} from the left.`);
    }

    visual.rows.forEach((row, r) => {
      const items = row.cells.map(normalise).map(item => itemWords(item, fillWords));
      const name = row.label || (visual.rows.length > 1 ? `Row ${r + 1}` : "From left to right");
      parts.push(`${name}: ${items.join(", ")}.`);
    });

    return parts.join(" ");
  }

  function shapeMarkup(shape, cx, cy, size) {
    const s = size * 0.3;
    if (shape === "circle") {
      return `<circle class="qv-shape" cx="${cx}" cy="${cy}" r="${s.toFixed(1)}" />`;
    }
    if (shape === "square") {
      return `<rect class="qv-shape" x="${(cx - s).toFixed(1)}" y="${(cy - s).toFixed(1)}" width="${(2 * s).toFixed(1)}" height="${(2 * s).toFixed(1)}" />`;
    }
    const h = s * 1.1;
    return `<path class="qv-shape" d="M${cx},${(cy - h).toFixed(1)} L${(cx + h).toFixed(1)},${(cy + h * 0.8).toFixed(1)} L${(cx - h).toFixed(1)},${(cy + h * 0.8).toFixed(1)} Z" />`;
  }

  function render(visual, ctx) {
    const hasLabels = visual.rows.some(row => row.label);
    const labelWidth = hasLabels ? Math.max(...visual.rows.map(row => (row.label || "").length)) * 8 + 14 : 0;
    const longest = Math.max(...visual.rows.map(row => row.cells.length));
    const size = Math.min(44, Math.floor((330 - labelWidth) / longest) - 4);
    const step = size + 4;
    const top = visual.numbered ? 20 : 2;
    const rowStep = size + 12;
    const width = labelWidth + longest * step + 2;
    const height = top + visual.rows.length * rowStep - 8;
    const from = visual.numberFrom === 0 ? 0 : 1;
    const parts = [V.svgOpen(ctx, width, height, label(visual), "qv-cells")];

    if (visual.numbered) {
      let n = from;
      visual.rows[0].cells.forEach((item, c) => {
        if (item !== GAP) {
          parts.push(`<text class="qv-axis" x="${labelWidth + c * step + size / 2 + 1}" y="${top - 6}" text-anchor="middle">${n}</text>`);
          n += 1;
        }
      });
    }

    visual.rows.forEach((row, r) => {
      const y = top + r * rowStep;

      if (row.label) {
        parts.push(`<text class="qv-rowlabel" x="0" y="${y + size / 2 + 5}">${V.esc(row.label)}</text>`);
      }

      row.cells.map(normalise).forEach((item, c) => {
        const x = labelWidth + c * step + 1;
        const cx = x + size / 2;
        const cy = y + size / 2;

        if (item.gap) {
          parts.push(`<text class="qv-cell__text" x="${cx}" y="${cy + 6}" text-anchor="middle">…</text>`);
          return;
        }

        parts.push(`<rect class="qv-cell ${item.fill === "dark" ? "qv-cell--dark" : "qv-cell--open"}" x="${x}" y="${y}" width="${size}" height="${size}" rx="3" />`);

        if (item.shape) {
          parts.push(shapeMarkup(item.shape, cx, cy, size));
        }
        if (item.text !== undefined) {
          parts.push(`<text class="qv-cell__text ${item.fill === "dark" ? "qv-cell__text--on-dark" : ""}" x="${cx}" y="${cy + 6}" text-anchor="middle">${V.esc(item.text)}</text>`);
        }
      });
    });

    parts.push("</svg>");
    return parts.join("");
  }

  return {
    kind: "cells",
    structured: true,
    purposes: ["information", "reading-load"],
    fields: ["rows", "numbered", "numberFrom", "fillWords"],
    validate,
    label,
    describe,
    render
  };
});
