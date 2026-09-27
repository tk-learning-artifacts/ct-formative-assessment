// Visual kind "graph": points joined by lines or arrows, with optional
// weights (ADR 0007). Networks, routes, "who connects to whom".
//
//   nodes        2 to 10 of { id, x, y }; id is the label drawn in the
//                circle (1 to 3 characters); x from 20 to 340, y from 20
//                to 280, placed by the author
//   edges        1 to 20 of { from, to, weight? }; weight a number or up
//                to 4 characters, drawn on the middle of the edge
//   directed     optional; true draws arrows from "from" to "to"
//   weightUnit   optional; the word the description puts after a weight
//                ("minutes")
//
// Positions are given, not laid out, so a figure stays where its author put
// it. Two edges between the same pair are refused: a two-way road is one
// undirected edge.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../visuals.js"));
  } else {
    root.CTQuestVisuals.register(factory(root.CTQuestVisuals));
  }
})(typeof self !== "undefined" ? self : this, function (V) {
  const R = 18;

  function validate(visual) {
    const errors = [];

    if (!Array.isArray(visual.nodes) || visual.nodes.length < 2 || visual.nodes.length > 10) {
      return ["nodes must be a list of 2 to 10 nodes"];
    }
    if (!Array.isArray(visual.edges) || visual.edges.length < 1 || visual.edges.length > 20) {
      return ["edges must be a list of 1 to 20 edges"];
    }

    const ids = new Set();

    visual.nodes.forEach((node, i) => {
      const where = `node ${i + 1}`;
      const keyErrors = V.checkKeys(node, ["id", "x", "y"], where);
      if (keyErrors.length) {
        errors.push(...keyErrors);
        return;
      }
      errors.push(...V.checkText(node.id, `${where} id`, { max: 3 }));
      if (ids.has(node.id)) {
        errors.push(`${where} id "${node.id}" is used twice`);
      }
      ids.add(node.id);
      errors.push(...V.checkInt(node.x, `${where} x`, 20, 340), ...V.checkInt(node.y, `${where} y`, 20, 280));
    });

    visual.nodes.forEach((a, i) => visual.nodes.slice(i + 1).forEach(b => {
      if (Math.hypot(a.x - b.x, a.y - b.y) < 3 * R) {
        errors.push(`nodes ${a.id} and ${b.id} are too close to read apart`);
      }
    }));

    const pairs = new Set();

    visual.edges.forEach((edge, i) => {
      const where = `edge ${i + 1}`;
      const keyErrors = V.checkKeys(edge, ["from", "to", "weight"], where);
      if (keyErrors.length) {
        errors.push(...keyErrors);
        return;
      }
      if (!ids.has(edge.from) || !ids.has(edge.to)) {
        errors.push(`${where} joins a node that does not exist (${edge.from} to ${edge.to})`);
      }
      if (edge.from === edge.to) {
        errors.push(`${where} joins ${edge.from} to itself`);
      }
      const pair = [edge.from, edge.to].sort().join("|");
      if (pairs.has(pair)) {
        errors.push(`${where} repeats the pair ${edge.from}, ${edge.to}`);
      }
      pairs.add(pair);
      if (edge.weight !== undefined && !(typeof edge.weight === "number" && Number.isFinite(edge.weight)) &&
        V.checkText(edge.weight, "weight", { max: 4 }).length) {
        errors.push(`${where} weight must be a number or up to 4 characters`);
      }
    });

    if (visual.directed !== undefined && typeof visual.directed !== "boolean") {
      errors.push("directed must be true or false");
    }
    if (visual.weightUnit !== undefined) {
      errors.push(...V.checkText(visual.weightUnit, "weightUnit", { max: 12 }));
    }

    return errors;
  }

  function label(visual) {
    return `A network of ${visual.nodes.length} points joined by ${visual.edges.length} ${visual.directed ? "arrows" : "lines"}`;
  }

  function describe(visual) {
    const unit = visual.weightUnit ? ` ${visual.weightUnit}` : "";
    const edges = visual.edges.map(edge => {
      const weight = edge.weight !== undefined ? ` (${edge.weight}${unit})` : "";
      return visual.directed ? `${edge.from} to ${edge.to}${weight}` : `${edge.from} and ${edge.to}${weight}`;
    });
    const joined = visual.directed ? `One-way arrows go from ${V.listWords(edges)}.` : `Lines join ${V.listWords(edges)}.`;
    return `${label(visual)}. The points are ${V.listWords(visual.nodes.map(node => node.id))}. ${joined}`;
  }

  function render(visual, ctx) {
    const byId = new Map(visual.nodes.map(node => [node.id, node]));
    const width = Math.max(...visual.nodes.map(node => node.x)) + R + 8;
    const height = Math.max(...visual.nodes.map(node => node.y)) + R + 8;
    const parts = [V.svgOpen(ctx, width, height, label(visual), "qv-graph")];

    if (visual.directed) {
      parts.push(V.arrowMarker(ctx));
    }

    const chips = [];

    visual.edges.forEach(edge => {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = (b.x - a.x) / length;
      const uy = (b.y - a.y) / length;
      const x1 = a.x + ux * R;
      const y1 = a.y + uy * R;
      const x2 = b.x - ux * (R + (visual.directed ? 2 : 0));
      const y2 = b.y - uy * (R + (visual.directed ? 2 : 0));
      const marker = visual.directed ? ` marker-end="url(#${ctx.id}-arrow)"` : "";

      parts.push(`<line class="qv-edge" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"${marker} />`);

      if (edge.weight !== undefined) {
        const text = String(edge.weight);
        const w = text.length * 8 + 10;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        chips.push(`<rect class="qv-chip" x="${(mx - w / 2).toFixed(1)}" y="${(my - 10).toFixed(1)}" width="${w}" height="20" rx="4" />`);
        chips.push(`<text class="qv-chip__text" x="${mx.toFixed(1)}" y="${(my + 5).toFixed(1)}" text-anchor="middle">${V.esc(text)}</text>`);
      }
    });

    parts.push(...chips);

    visual.nodes.forEach(node => {
      parts.push(`<circle class="qv-node" cx="${node.x}" cy="${node.y}" r="${R}" />`);
      parts.push(`<text class="qv-node__text" x="${node.x}" y="${node.y + 6}" text-anchor="middle">${V.esc(node.id)}</text>`);
    });

    parts.push("</svg>");
    return parts.join("");
  }

  return {
    kind: "graph",
    structured: true,
    purposes: ["information", "reading-load"],
    fields: ["nodes", "edges", "directed", "weightUnit"],
    validate,
    label,
    describe,
    render
  };
});
