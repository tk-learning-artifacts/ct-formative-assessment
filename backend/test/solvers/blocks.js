// Solvers for backend/content/questions/blocks.json.
//
// A block question's key is its reference solution, which the answer-key test
// runs through the server's interpreter on every stage. What a solver adds is
// an independent check of the stages themselves: it reads each grid and works
// out what the expectation should be, without the interpreter. A breadth-first
// search says whether the flag and every star can be reached at all, and the
// counting question's answer is the number of stars on its path. The test
// then requires each stage's "expect" to agree, so a grid edited without its
// expectation (or an unreachable flag) fails.

const MOVES = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function cell(grid, x, y) {
  return y < 0 || y >= grid.length || x < 0 || x >= grid[0].length ? "#" : grid[y][x];
}

// Every open cell reachable from the start.
function reachable(stage) {
  const seen = new Set([`${stage.start.x},${stage.start.y}`]);
  const queue = [[stage.start.x, stage.start.y]];

  while (queue.length) {
    const [x, y] = queue.shift();
    MOVES.forEach(([dx, dy]) => {
      const key = `${x + dx},${y + dy}`;
      if (cell(stage.grid, x + dx, y + dy) !== "#" && !seen.has(key)) {
        seen.add(key);
        queue.push([x + dx, y + dy]);
      }
    });
  }

  return seen;
}

function spots(stage, char) {
  const found = [];
  stage.grid.forEach((row, y) => Array.from(row).forEach((c, x) => {
    if (c === char) {
      found.push(`${x},${y}`);
    }
  }));
  return found;
}

// What each expectation should be: the flag reachable, every star
// reachable. A stage that expects either when it is impossible disagrees.
function mazeFacts(stage) {
  const open = reachable(stage);
  const facts = {};

  if (stage.expect.reachGoal) {
    facts.reachGoal = spots(stage, "G").some(spot => open.has(spot));
  }
  if (stage.expect.collectAll) {
    facts.collectAll = spots(stage, "*").every(spot => open.has(spot));
  }

  return facts;
}

function stages(question) {
  return [question.example].concat(question.cases || []);
}

function reachEverything(question) {
  return stages(question).map(mazeFacts);
}

module.exports = {
  "BLK-P5-01": reachEverything,
  "BLK-P6-01": reachEverything,
  "BLK-S1-01": reachEverything,
  "BLK-S2-01": reachEverything,

  // The sprite walks every open cell of a straight path, so the count it
  // should say is the number of stars in the grid.
  "BLK-RGS-S1-01": question => stages(question).map(stage => ({
    ...mazeFacts(stage),
    say: String(spots(stage, "*").length)
  })),

  "BLK-RGS-S2-01": reachEverything
};
