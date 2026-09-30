// web/charts.js: the teacher's inline-SVG charts. web/ is an ES module
// package (for Vite), so the file is run here in a small context with a
// CommonJS-style module object, which its UMD wrapper fills in.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const source = fs.readFileSync(path.join(__dirname, "../../web/charts.js"), "utf8");
const mod = { exports: {} };
vm.runInNewContext(source, { module: mod });
const { barChart, histogram, wrap } = mod.exports;

test("barChart: one labelled bar per row, with a text equivalent", () => {
  const svg = barChart([
    { label: "Loops", value: 40 },
    { label: "Conditionals", value: 75, note: "1 not marked yet" },
    { label: "Events", value: null }
  ], { threshold: 50, title: "CT capabilities" });

  assert.match(svg, /<svg[^>]*role="img"/);
  assert.match(svg, /<title id="[^"]+">CT capabilities<\/title>/);
  assert.match(svg, /<desc id="[^"]+">[^<]*Loops: 40% below 50%[^<]*Conditionals: 75%[^<]*Events: Not marked/);
  assert.equal((svg.match(/class="chart__bar[ "]/g) || []).length, 2, "no bar for the null row");
  assert.equal((svg.match(/chart__bar--below/g) || []).length, 1);
  // The value and the status word are drawn beside the bar.
  assert.match(svg, />40%<tspan class="chart__flag"> below 50%<\/tspan>/);
  assert.match(svg, />75%</);
  assert.match(svg, />1 not marked yet</);
  // Colour is left to style.css: no inline colour in the markup.
  assert.doesNotMatch(svg, /fill="|stroke="|style="|#[0-9a-fA-F]{3,6}\b|rgb\(/);
});

test("barChart: a comparison tick and a legend naming both", () => {
  const svg = barChart([{ label: "Score", value: 30, compare: 62 }], {
    threshold: 50, valueLabel: "This student", compareLabel: "Class average"
  });

  assert.match(svg, /class="chart__compare"/);
  assert.match(svg, /chart__legend[^]*This student[^]*Class average/);
  assert.match(svg, /Class average 62%/);
});

test("barChart and histogram are safe on empty or all-null input", () => {
  [barChart([]), barChart(null), barChart([{ label: "x", value: null }]), histogram([]), histogram(null), histogram([null, undefined, "7"], 5)]
    .forEach(markup => {
      assert.match(markup, /^<p class="chart-empty/);
      assert.doesNotMatch(markup, /<svg|NaN|undefined/);
    });
});

test("barChart clamps values and escapes labels", () => {
  const svg = barChart([{ label: "<b>&x</b>", value: 250 }, { label: "neg", value: -5 }]);
  assert.match(svg, /&lt;b&gt;&amp;x&lt;\/b&gt;/);
  assert.doesNotMatch(svg, /<b>/);
  assert.match(svg, /width="82%" height="14" rx="3" \/><text/, "250 is drawn as a full bar");
  assert.doesNotMatch(svg, /NaN/);
});

test("histogram: counts per bin, 100 in the last bin, a text equivalent", () => {
  const svg = histogram([0, 10, 49.9, 50, 100, 100, null], 10);

  assert.match(svg, /<svg[^>]*role="img"/);
  assert.match(svg, /<desc id="[^"]+">6 students\. 0 to 9%: 1; 10 to 19%: 1; 20 to 29%: 0; 30 to 39%: 0; 40 to 49%: 1; 50 to 59%: 1;[^<]*90 to 100%: 2\./);
  assert.equal((svg.match(/class="chart__bar[ "]/g) || []).length, 5, "one column per non-empty bin");
  assert.equal((svg.match(/chart__bar--below/g) || []).length, 3, "bins under 50% are marked");
  assert.match(svg, />100%<\/text>/, "the axis runs to 100%");
});

test("the teacher page loads charts.js before admin.js; the student page does not load it", () => {
  const web = file => fs.readFileSync(path.join(__dirname, "../../web", file), "utf8");
  const admin = web("admin.html");
  assert.ok(admin.indexOf('src="charts.js"') > -1, "admin.html loads charts.js");
  assert.ok(admin.indexOf('src="charts.js"') < admin.indexOf('src="admin.js"'), "before admin.js");
  assert.doesNotMatch(web("index.html"), /charts\.js/);
});

test("wrap keeps labels to two lines and marks a cut", () => {
  // The array comes from the vm context, so compare its contents.
  assert.equal(JSON.stringify(wrap("short", 20, 2)), JSON.stringify(["short"]));
  const lines = wrap("one two three four five six seven eight nine ten", 12, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith("…"));
  lines.forEach(line => assert.ok(line.length <= 13, line));
});
