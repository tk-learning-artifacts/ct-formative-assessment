// Visual kind "flowchart": boxes and arrows for a rule or a procedure
// (ADR 0007), loops included.
//
//   nodes   2 to 12 of { id, type, text, col, row }
//             type   "start" | "end" (rounded), "process" (box),
//                    "decision" (diamond; exactly two labelled arrows out)
//             text   short: up to 2 lines in a diamond or a rounded box,
//                    3 in a process box (13 or 14 characters a line)
//             col    0 or 1; row 0 to 7. Two columns keep the text readable
//                    on a 390px phone
//   edges   { from, to, label?, exit?, enter? }
//             exit   "bottom" (default), "left" or "right" of the box it
//                    leaves
//             enter  "top" (default), "left" or "right" of the box it enters
//
// Arrows are drawn with right angles. An arrow that has to go back up (a
// loop) runs along a lane at the left or right edge of the figure, chosen
// by the side it leaves or enters from. Exactly one start; every box but an
// end has an arrow out.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../visuals.js"));
  } else {
    root.CTQuestVisuals.register(factory(root.CTQuestVisuals));
  }
})(typeof self !== "undefined" ? self : this, function (V) {
  const TYPES = ["start", "end", "process", "decision"];
  // Box sizes leave a 28-unit gap between columns, room for a "Yes" or
  // "No" on an arrow that leaves from the side.
  const SIZE = {
    start: { w: 112, h: 44, chars: 14, lines: 2 },
    end: { w: 112, h: 44, chars: 14, lines: 2 },
    process: { w: 112, h: 52, chars: 14, lines: 3 },
    decision: { w: 132, h: 64, chars: 13, lines: 2 }
  };
  const COL_W = 150;
  const ROW_H = 88;
  const MARGIN_X = 22;
  const TOP = 6;
  const STUB = 12;
  const LINE_H = 15;
  const DIRS = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

  function centre(node) {
    return { x: MARGIN_X + node.col * COL_W + COL_W / 2, y: TOP + node.row * ROW_H + ROW_H / 2 };
  }

  function port(node, side) {
    const c = centre(node);
    const s = SIZE[node.type];
    return { x: c.x + DIRS[side][0] * s.w / 2, y: c.y + DIRS[side][1] * s.h / 2 };
  }

  function dims(visual) {
    const cols = Math.max(...visual.nodes.map(node => node.col)) + 1;
    const rows = Math.max(...visual.nodes.map(node => node.row)) + 1;
    return { width: MARGIN_X * 2 + cols * COL_W, height: TOP * 2 + rows * ROW_H };
  }

  // The corner points of one arrow, or a string saying why it cannot be
  // drawn with these ports.
  function route(visual, edge, byId) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    const exit = edge.exit || "bottom";
    const enter = edge.enter || "top";
    const P = port(a, exit);
    const Q = port(b, enter);
    const d1 = DIRS[exit];
    const d2 = DIRS[enter];
    const P1 = { x: P.x + d1[0] * STUB, y: P.y + d1[1] * STUB };
    const Q1 = { x: Q.x + d2[0] * STUB, y: Q.y + d2[1] * STUB };
    const { width } = dims(visual);
    const lane = side => (side === "left" ? MARGIN_X / 2 : width - MARGIN_X / 2);
    const pt = (x, y) => ({ x, y });

    if (exit === "bottom" && enter === "top") {
      if (Q.y <= P.y) {
        return "goes up out of the bottom of a box; leave from a side instead";
      }
      if (P.x === Q.x) {
        return [P, Q];
      }
      const mid = (P.y + Q.y) / 2;
      return [P, pt(P.x, mid), pt(Q.x, mid), Q];
    }

    if (exit !== "bottom" && enter === "top") {
      const ahead = Math.sign(Q.x - P.x) === d1[0];
      if (ahead && Q1.y >= P.y) {
        return [P, pt(Q.x, P.y), Q];
      }
      const x = lane(exit);
      return [P, pt(x, P.y), pt(x, Q1.y), pt(Q.x, Q1.y), Q];
    }

    if (exit === "bottom") {
      const facing = (enter === "left" && P.x < Q.x) || (enter === "right" && P.x > Q.x);
      if (facing && Q.y > P1.y) {
        return [P, pt(P.x, Q.y), Q];
      }
      const x = lane(enter);
      return [P, P1, pt(x, P1.y), pt(x, Q.y), Q];
    }

    if (exit === enter) {
      const x = lane(exit);
      return [P, pt(x, P.y), pt(x, Q.y), Q];
    }

    if ((exit === "right" && Q.x > P.x) || (exit === "left" && Q.x < P.x)) {
      const mx = (P.x + Q.x) / 2;
      return [P, pt(mx, P.y), pt(mx, Q.y), Q];
    }

    return `cannot go from the ${exit} of ${edge.from} to the ${enter} of ${edge.to}`;
  }

  function validate(visual) {
    const errors = [];

    if (!Array.isArray(visual.nodes) || visual.nodes.length < 2 || visual.nodes.length > 12) {
      return ["nodes must be a list of 2 to 12 boxes"];
    }
    if (!Array.isArray(visual.edges) || visual.edges.length < 1) {
      return ["edges must be a list of at least one arrow"];
    }

    const byId = new Map();
    const cells = new Set();

    visual.nodes.forEach((node, i) => {
      const where = `box ${i + 1}`;
      const keyErrors = V.checkKeys(node, ["id", "type", "text", "col", "row"], where);
      if (keyErrors.length) {
        errors.push(...keyErrors);
        return;
      }
      errors.push(...V.checkText(node.id, `${where} id`, { max: 20 }));
      if (byId.has(node.id)) {
        errors.push(`${where} id "${node.id}" is used twice`);
      }
      byId.set(node.id, node);
      if (!TYPES.includes(node.type)) {
        errors.push(`${where} type must be one of ${TYPES.join(", ")}`);
        return;
      }
      const textErrors = V.checkText(node.text, `${where} text`, { max: 60 });
      errors.push(...textErrors);
      if (!textErrors.length) {
        const size = SIZE[node.type];
        const lines = V.wrap(node.text, size.chars);
        if (lines.length > size.lines || lines.some(line => line.length > size.chars)) {
          errors.push(`${where} text does not fit a ${node.type} box (at most ${size.lines} lines of ${size.chars} characters)`);
        }
      }
      errors.push(...V.checkInt(node.col, `${where} col`, 0, 1), ...V.checkInt(node.row, `${where} row`, 0, 7));
      const cell = `${node.col},${node.row}`;
      if (cells.has(cell)) {
        errors.push(`${where} sits on another box (col ${node.col}, row ${node.row})`);
      }
      cells.add(cell);
    });

    if (errors.length) {
      return errors;
    }

    if (visual.nodes.filter(node => node.type === "start").length !== 1) {
      errors.push("needs exactly one start box");
    }

    visual.edges.forEach((edge, i) => {
      const where = `arrow ${i + 1}`;
      const keyErrors = V.checkKeys(edge, ["from", "to", "label", "exit", "enter"], where);
      if (keyErrors.length) {
        errors.push(...keyErrors);
        return;
      }
      if (!byId.has(edge.from) || !byId.has(edge.to)) {
        errors.push(`${where} joins a box that does not exist (${edge.from} to ${edge.to})`);
        return;
      }
      if (edge.label !== undefined) {
        errors.push(...V.checkText(edge.label, `${where} label`, { max: 5 }));
      }
      if (edge.exit !== undefined && !["bottom", "left", "right"].includes(edge.exit)) {
        errors.push(`${where} exit must be bottom, left or right`);
        return;
      }
      if (edge.enter !== undefined && !["top", "left", "right"].includes(edge.enter)) {
        errors.push(`${where} enter must be top, left or right`);
        return;
      }
      if (byId.get(edge.from).type === "end") {
        errors.push(`${where} leaves an end box`);
      }
      const drawn = route(visual, edge, byId);
      if (typeof drawn === "string") {
        errors.push(`${where} ${drawn}`);
      }
    });

    visual.nodes.forEach(node => {
      const out = visual.edges.filter(edge => edge.from === node.id);
      if (node.type === "decision") {
        const labels = out.map(edge => edge.label).filter(Boolean);
        if (out.length !== 2 || labels.length !== 2 || labels[0] === labels[1]) {
          errors.push(`decision "${node.id}" needs exactly two arrows out with different labels`);
        }
      } else if (node.type !== "end" && !out.length) {
        errors.push(`box "${node.id}" has no arrow out`);
      }
    });

    return errors;
  }

  function label(visual) {
    return `A flowchart with ${visual.nodes.length} boxes`;
  }

  function quote(text) {
    return `“${text}”`;
  }

  function describe(visual) {
    const byId = new Map(visual.nodes.map(node => [node.id, node]));
    const ordered = visual.nodes.slice().sort((a, b) => a.row - b.row || a.col - b.col);
    const start = visual.nodes.find(node => node.type === "start");
    const parts = [`${label(visual)}, read from the top. It starts at ${quote(start.text)}.`];

    ordered.forEach(node => {
      const out = visual.edges.filter(edge => edge.from === node.id);
      if (node.type === "end") {
        parts.push(`${quote(node.text)} is an end.`);
      } else if (node.type === "decision") {
        parts.push(`The question ${quote(node.text)}: ${out.map(edge => `${edge.label} leads to ${quote(byId.get(edge.to).text)}`).join("; ")}.`);
      } else {
        parts.push(`${quote(node.text)} leads to ${out.map(edge => quote(byId.get(edge.to).text)).join(" and ")}.`);
      }
    });

    return parts.join(" ");
  }

  function shape(node) {
    const c = centre(node);
    const s = SIZE[node.type];
    const x = c.x - s.w / 2;
    const y = c.y - s.h / 2;

    if (node.type === "decision") {
      return `<path class="qv-box qv-box--decision" d="M${c.x},${y} L${x + s.w},${c.y} L${c.x},${y + s.h} L${x},${c.y} Z" />`;
    }
    if (node.type === "process") {
      return `<rect class="qv-box" x="${x}" y="${y}" width="${s.w}" height="${s.h}" rx="3" />`;
    }
    return `<rect class="qv-box qv-box--terminal" x="${x}" y="${y}" width="${s.w}" height="${s.h}" rx="${s.h / 2}" />`;
  }

  function text(node) {
    const c = centre(node);
    const lines = V.wrap(node.text, SIZE[node.type].chars);
    const first = c.y - ((lines.length - 1) * LINE_H) / 2 + 5;
    return `<text class="qv-box__text" text-anchor="middle">${lines.map((line, i) =>
      `<tspan x="${c.x}" y="${first + i * LINE_H}">${V.esc(line)}</tspan>`).join("")}</text>`;
  }

  function render(visual, ctx) {
    const byId = new Map(visual.nodes.map(node => [node.id, node]));
    const { width, height } = dims(visual);
    const parts = [V.svgOpen(ctx, width, height, label(visual), "qv-flow"), V.arrowMarker(ctx)];
    const labels = [];

    visual.edges.forEach(edge => {
      const points = route(visual, edge, byId);
      if (typeof points === "string") {
        return;
      }
      parts.push(`<polyline class="qv-edge" points="${points.map(p => `${p.x},${p.y}`).join(" ")}" marker-end="url(#${ctx.id}-arrow)" />`);

      if (edge.label) {
        const P = points[0];
        const exit = edge.exit || "bottom";
        const lx = exit === "left" ? P.x - 4 : P.x + 4;
        const ly = exit === "bottom" ? P.y + 14 : P.y - 5;
        labels.push(`<text class="qv-edge__label" x="${lx}" y="${ly}" text-anchor="${exit === "left" ? "end" : "start"}">${V.esc(edge.label)}</text>`);
      }
    });

    visual.nodes.forEach(node => {
      parts.push(shape(node), text(node));
    });

    parts.push(...labels, "</svg>");
    return parts.join("");
  }

  return {
    kind: "flowchart",
    structured: true,
    purposes: ["information", "reading-load"],
    fields: ["nodes", "edges"],
    validate,
    label,
    describe,
    render
  };
});
