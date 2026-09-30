// Static checks on the Parsons renderer and the student loading styles: the
// hooks the answer code relies on stay, and the workspace and tray panels
// that make the task readable are present.

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const web = file => fs.readFileSync(path.join(__dirname, "../../web", file), "utf8");

test("parsons renderer keeps its data hooks and shows workspace and tray panels", () => {
  const renderer = web("types/parsons.js");
  assert.match(renderer, /data-pa-program/);
  assert.match(renderer, /data-pa-pool/);
  assert.match(renderer, /class="pa-workspace/);
  assert.match(renderer, /class="pa-tray"/);
  assert.match(renderer, /Your program is empty\. Add lines from the tray below, or drag them here\./);
  assert.match(renderer, /Code blocks: tap Add to use one/);
  assert.match(renderer, /data-pa-count/);
  assert.match(renderer, /aria-label="Add to program: /);
  // The response is still counted from .pa-line only.
  assert.match(renderer, /querySelectorAll\("\.pa-line"\)/);
});

test("style.css has the Parsons panels and the loading classes", () => {
  const css = web("style.css");

  for (const selector of [".pa-workspace", ".pa-tray", ".pa-dropzone", ".skeleton", ".spinner", '.btn[aria-busy="true"]']) {
    assert.ok(css.includes(selector), `style.css should define ${selector}`);
  }

  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(web("index.html"), /class="skeleton/);
});
