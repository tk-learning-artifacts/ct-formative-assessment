// docker-compose.yml lists the container's environment explicitly, so a
// setting config.js reads but compose leaves out is silently dropped in
// Docker (SEED_TEACHER_ROLE was, after the admin role was added). Every
// setting must be passed through, except the ones the container fixes or
// must not have.

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "../..");
// HOST must stay unset in the container, and DB_PATH is fixed by the volume.
const NOT_PASSED = ["HOST", "DB_PATH"];

test("docker-compose.yml passes every setting config.js reads", () => {
  const config = fs.readFileSync(path.join(ROOT, "backend/src/config.js"), "utf8");
  const compose = fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");
  const settings = Array.from(new Set(config.match(/env\.[A-Z_]+/g).map(ref => ref.slice(4))));
  const passed = new Set(Array.from(compose.matchAll(/^\s{6}([A-Z_]+):/gm), match => match[1]));

  assert.ok(settings.includes("SEED_TEACHER_ROLE"));
  assert.deepEqual(settings.filter(name => !NOT_PASSED.includes(name) && !passed.has(name)), []);
});
