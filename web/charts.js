// Small inline-SVG charts for the teacher's results view. No library: two
// forms cover what the page needs, and each returns a markup string the
// page drops into a template, like the rest of admin.js.
//
//   barChart(rows, opts)     horizontal bars on a 0..max scale, one per row
//   histogram(values, bins)  counts of 0..100 scores in equal-width bins
//
// Conventions (ADR 0002, "Charts"):
// - Colour comes from classes styled in style.css, never from here, so a
//   retint of the :root tokens reaches the charts too.
// - Every value is written beside its mark; nothing depends on hover or on
//   colour alone. A bar below the threshold says so in words ("below 50%").
// - Each <svg> is role="img" with a <title> and a <desc> that list every
//   value, so a screen reader gets the same content as the picture.
// - Widths are percentages of the chart's own width and text is sized in
//   CSS pixels, so the chart fills a 390px phone or a 1280px screen without
//   shrinking its labels. Labels wrap to two lines by character count; the
//   full text is in each row's <title> and in the table beside the chart.
// - Empty input (no rows, or every value null) gives a short text figure,
//   never a broken or blank SVG.
//
// UMD like web/lib/blocks-engine.js, so node can require it for tests.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CTQuestCharts = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  const ROW_GAP = 10;
  const LINE_HEIGHT = 16;
  const BAR_HEIGHT = 14;
  // The share of the width the bars may use; the rest holds the value label
  // at the tip of a full-length bar.
  const PLOT = 82;
  // A histogram column's width in pixels (the mark spec's 24px cap).
  const COLUMN = 24;
  let idCounter = 0;

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function nextId(prefix) {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
  }

  // Splits text into at most maxLines lines of about width characters,
  // breaking at spaces; the last line ends in an ellipsis if text is left.
  function wrap(text, width, maxLines) {
    const words = String(text).replace(/\s+/g, " ").trim().split(" ");
    const lines = [];
    let current = "";

    words.forEach(word => {
      if (lines.length >= maxLines) {
        return;
      }

      const candidate = current ? `${current} ${word}` : word;

      if (candidate.length <= width || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    });

    if (current && lines.length < maxLines) {
      lines.push(current);
    }

    const used = lines.join(" ").length;
    const full = String(text).replace(/\s+/g, " ").trim();

    if (used < full.length && lines.length) {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = `${last.slice(0, Math.max(1, width - 1)).replace(/\s+$/, "")}…`;
    }

    return lines.map(line => (line.length > width + 1 ? `${line.slice(0, width)}…` : line));
  }

  // A percentage coordinate, rounded so the markup stays short.
  function pct(value) {
    return `${Math.round(value * 100) / 100}%`;
  }

  function formatValue(value, unit) {
    return `${Math.round(value * 10) / 10}${unit}`;
  }

  function emptyFigure(text) {
    return `<p class="chart-empty muted small">${esc(text)}</p>`;
  }

  // rows: [{ label, value (number or null), note?, indent?, compare?, valueText? }]
  //   label      text beside the bar (wrapped, full text kept in <title>)
  //   value      the bar's length on 0..max; null draws no bar and says
  //              opts.nullText instead
  //   note       an optional muted second line under the label
  //   indent     nesting depth (0, 1, 2): indents the label, not the bar,
  //              so every bar keeps the same baseline
  //   compare    an optional second value drawn as a tick across the bar
  //              (a class average beside a student's own bar)
  // opts: { max = 100, threshold = null, unit = "%", title, desc,
  //         nullText = "Not marked", compareLabel, valueLabel, wrapAt = 46,
  //         emptyText }
  function barChart(rows, opts = {}) {
    const max = isNumber(opts.max) && opts.max > 0 ? opts.max : 100;
    const threshold = isNumber(opts.threshold) ? opts.threshold : null;
    const unit = opts.unit === undefined ? "%" : opts.unit;
    const nullText = opts.nullText || "Not marked";
    const wrapAt = opts.wrapAt || 46;
    const list = Array.isArray(rows) ? rows.filter(Boolean) : [];

    if (!list.length) {
      return emptyFigure(opts.emptyText || "Nothing to show yet.");
    }

    if (list.every(row => !isNumber(row.value))) {
      return emptyFigure(opts.emptyText || `${nullText} yet.`);
    }

    const hasCompare = list.some(row => isNumber(row.compare));
    const scale = value => Math.max(0, Math.min(value, max)) / max * PLOT;
    const titleId = nextId("chart-title");
    const descId = nextId("chart-desc");
    const describe = [];
    let y = 4;
    const parts = [];

    list.forEach(row => {
      const indent = Math.max(0, Math.min(Number(row.indent) || 0, 3)) * 14;
      const lines = wrap(row.label, wrapAt - Math.round(indent / 7), 2);
      const noteLines = row.note ? 1 : 0;
      const below = threshold !== null && isNumber(row.value) && row.value < threshold;
      const valueText = isNumber(row.value) ? (row.valueText || formatValue(row.value, unit)) : nullText;
      const status = below ? ` below ${formatValue(threshold, unit)}` : "";
      const compareText = isNumber(row.compare) ? `; ${opts.compareLabel || "compare"} ${formatValue(row.compare, unit)}` : "";
      const spoken = `${row.label}: ${valueText}${status}${compareText}${row.note ? `. ${row.note}` : ""}`;
      describe.push(spoken);

      const labelSvg = lines.map((line, i) =>
        `<text class="chart__label" x="${indent}" y="${y + LINE_HEIGHT * (i + 1) - 4}">${esc(line)}</text>`).join("");
      const noteSvg = row.note
        ? `<text class="chart__note" x="${indent}" y="${y + LINE_HEIGHT * (lines.length + 1) - 4}">${esc(row.note)}</text>`
        : "";
      const barY = y + LINE_HEIGHT * (lines.length + noteLines) + 2;
      const width = isNumber(row.value) ? scale(row.value) : 0;
      const bar = isNumber(row.value) && width > 0
        ? `<rect class="chart__bar${below ? " chart__bar--below" : ""}" x="0" y="${barY}" width="${pct(width)}" height="${BAR_HEIGHT}" rx="3" />`
        : "";
      const tick = isNumber(row.compare)
        ? `<rect class="chart__compare" x="${pct(scale(row.compare))}" y="${barY - 3}" width="2" height="${BAR_HEIGHT + 6}" />`
        : "";
      const labelX = isNumber(row.value) ? pct(width) : "0";
      // The threshold is marked on each bar's band, not across the labels.
      const rowThreshold = threshold !== null && threshold > 0 && threshold < max
        ? `<line class="chart__threshold" x1="${pct(scale(threshold))}" x2="${pct(scale(threshold))}" y1="${barY - 2}" y2="${barY + BAR_HEIGHT + 2}" />`
        : "";
      const value = `<text class="chart__value${isNumber(row.value) ? "" : " chart__value--none"}" x="${labelX}" dx="${isNumber(row.value) ? 6 : 0}" y="${barY + BAR_HEIGHT - 3}">${esc(valueText)}${below ? `<tspan class="chart__flag"> below ${esc(formatValue(threshold, unit))}</tspan>` : ""}</text>`;

      parts.push(`<g class="chart__row"><title>${esc(spoken)}</title>${labelSvg}${noteSvg}<rect class="chart__track" x="0" y="${barY}" width="${PLOT}%" height="${BAR_HEIGHT}" rx="3" />${bar}${rowThreshold}${tick}${value}</g>`);
      y = barY + BAR_HEIGHT + ROW_GAP;
    });

    const height = y;
    const thresholdLine = threshold !== null && threshold > 0 && threshold < max;
    const legend = hasCompare
      ? `<p class="chart__legend small"><span class="chart__key chart__key--bar" aria-hidden="true"></span>${esc(opts.valueLabel || "Value")}<span class="chart__key chart__key--compare" aria-hidden="true"></span>${esc(opts.compareLabel || "Compare")}${thresholdLine ? `<span class="chart__key chart__key--threshold" aria-hidden="true"></span>${esc(formatValue(threshold, unit))} line` : ""}</p>`
      : thresholdLine ? `<p class="chart__legend small"><span class="chart__key chart__key--threshold" aria-hidden="true"></span>${esc(formatValue(threshold, unit))} line</p>` : "";
    const title = opts.title || "Bar chart";
    const desc = opts.desc ? `${opts.desc} ${describe.join(". ")}.` : `${describe.join(". ")}.`;

    return `<figure class="chart chart--bars">${legend}<svg class="chart__svg" width="100%" height="${height}" role="img" aria-labelledby="${titleId} ${descId}"><title id="${titleId}">${esc(title)}</title><desc id="${descId}">${esc(desc)}</desc>${parts.join("")}</svg></figure>`;
  }

  // values: scores on 0..100 (nulls and non-numbers are skipped). bins: how
  // many equal-width bins (default 10); 100 falls in the last one.
  // opts: { title, desc, threshold = 50, unitLabel = "student", emptyText }
  function histogram(values, bins, opts = {}) {
    const count = Math.max(1, Math.min(Math.floor(Number(bins) || 10), 20));
    const threshold = opts.threshold === undefined ? 50 : opts.threshold;
    const noun = opts.unitLabel || "student";
    const scores = (Array.isArray(values) ? values : []).filter(isNumber).map(value => Math.max(0, Math.min(value, 100)));

    if (!scores.length) {
      return emptyFigure(opts.emptyText || "No marked scores yet.");
    }

    const size = 100 / count;
    const counts = Array.from({ length: count }, () => 0);
    scores.forEach(score => {
      counts[Math.min(count - 1, Math.floor(score / size))] += 1;
    });

    const most = Math.max(...counts);
    const plotTop = 18;
    const plotHeight = 96;
    const base = plotTop + plotHeight;
    const colWidth = 100 / count;
    const barWidth = colWidth * 0.72;
    const titleId = nextId("chart-title");
    const descId = nextId("chart-desc");
    const plural = n => `${n} ${noun}${n === 1 ? "" : "s"}`;
    const rangeText = i => {
      const low = Math.round(i * size);
      const high = i === count - 1 ? 100 : Math.round((i + 1) * size) - 1;
      return low === high ? `${low}%` : `${low} to ${high}%`;
    };

    const columns = counts.map((n, i) => {
      const x = i * colWidth + (colWidth - barWidth) / 2;
      const height = n ? Math.max(3, (n / most) * plotHeight) : 0;
      const below = isNumber(threshold) && (i + 1) * size <= threshold;
      const label = `${rangeText(i)}: ${plural(n)}`;

      return `<g class="chart__row"><title>${esc(label)}</title>${n
        // A column is at most COLUMN px wide: a percentage centre, shifted
        // back by half the width in pixels, so it never fills its slot.
        ? `<rect class="chart__bar${below ? " chart__bar--below" : ""}" x="${pct(x + barWidth / 2)}" y="${base - height}" width="${COLUMN}" height="${height}" rx="3" transform="translate(-${COLUMN / 2} 0)" /><text class="chart__value" x="${pct(x + barWidth / 2)}" y="${base - height - 4}" text-anchor="middle">${n}</text>`
        : ""}</g>`;
    }).join("");

    const tickEvery = count > 5 ? 2 : 1;
    const ticks = Array.from({ length: count + 1 }, (_, i) => i)
      .filter(i => i % tickEvery === 0 || i === count)
      .map(i => {
        const anchor = i === 0 ? "start" : i === count ? "end" : "middle";
        return `<text class="chart__axis-label" x="${pct(i * colWidth)}" y="${base + 16}" text-anchor="${anchor}">${Math.round(i * size)}%</text>`;
      }).join("");

    const thresholdLine = isNumber(threshold) && threshold > 0 && threshold < 100
      ? `<line class="chart__threshold" x1="${threshold}%" x2="${threshold}%" y1="${plotTop - 6}" y2="${base}" />`
      : "";
    const describe = counts.map((n, i) => `${rangeText(i)}: ${n}`).join("; ");
    const title = opts.title || "Score distribution";
    const desc = `${opts.desc ? `${opts.desc} ` : ""}${plural(scores.length)}. ${describe}.`;
    const legend = thresholdLine
      ? `<p class="chart__legend small"><span class="chart__key chart__key--bar" aria-hidden="true"></span>${esc(`At or above ${threshold}%`)}<span class="chart__key chart__key--below" aria-hidden="true"></span>${esc(`Below ${threshold}%`)}<span class="chart__key chart__key--threshold" aria-hidden="true"></span>${esc(`${threshold}% line`)}</p>`
      : "";

    return `<figure class="chart chart--hist">${legend}<svg class="chart__svg" width="100%" height="${base + 22}" role="img" aria-labelledby="${titleId} ${descId}"><title id="${titleId}">${esc(title)}</title><desc id="${descId}">${esc(desc)}</desc>${thresholdLine}<line class="chart__baseline" x1="0" x2="100%" y1="${base}" y2="${base}" />${columns}${ticks}</svg></figure>`;
  }

  return { barChart, histogram, wrap };
}));
