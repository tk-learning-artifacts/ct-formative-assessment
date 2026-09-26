// Small helpers the answer-key solvers share. Solvers read the question's own
// text (prompt, art, code, options) and compute the answer, so a question
// edited without updating its key fails the test.

function must(match, what) {
  if (!match) {
    throw new Error(`solver could not find ${what} in the question text; update the solver`);
  }
  return match;
}

function numberWord(word) {
  const words = { once: 1, twice: 2, "three times": 3, "four times": 4 };
  const value = words[String(word).toLowerCase()];
  return value === undefined ? Number(word) : value;
}

// Breadth-first search on a text grid: S start, T target, # wall, 4-neighbour moves.
function gridShortestPath(art) {
  const rows = art.trim().split("\n").map(line => line.trim().split(/\s+/));
  let start = null;
  let target = null;

  rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell === "S") start = [r, c];
    if (cell === "T") target = [r, c];
  }));

  must(start && target, "S and T in the grid");

  const seen = new Set([start.join(",")]);
  let frontier = [start];
  let steps = 0;

  while (frontier.length) {
    const next = [];

    for (const [r, c] of frontier) {
      if (r === target[0] && c === target[1]) {
        return steps;
      }

      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;
        const key = `${nr},${nc}`;

        if (rows[nr] && rows[nr][nc] && rows[nr][nc] !== "#" && !seen.has(key)) {
          seen.add(key);
          next.push([nr, nc]);
        }
      });
    }

    frontier = next;
    steps += 1;
  }

  return null;
}

function countInversions(values) {
  let count = 0;

  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (values[i] > values[j]) count += 1;
    }
  }

  return count;
}

// Dijkstra over a directed weighted edge list [{ from, to, cost }].
function cheapestCost(edges, source, target) {
  const dist = new Map([[source, 0]]);
  const done = new Set();

  while (true) {
    let current = null;

    dist.forEach((d, node) => {
      if (!done.has(node) && (current === null || d < dist.get(current))) current = node;
    });

    if (current === null) return null;
    if (current === target) return dist.get(current);

    done.add(current);

    edges.filter(edge => edge.from === current).forEach(edge => {
      const candidate = dist.get(current) + edge.cost;
      if (!dist.has(edge.to) || candidate < dist.get(edge.to)) dist.set(edge.to, candidate);
    });
  }
}

// Number of distinct shortest paths in an unweighted directed graph.
function countShortestPaths(adjacency, source, target) {
  const dist = new Map([[source, 0]]);
  const ways = new Map([[source, 1]]);
  const queue = [source];

  while (queue.length) {
    const node = queue.shift();

    (adjacency[node] || []).forEach(next => {
      if (!dist.has(next)) {
        dist.set(next, dist.get(node) + 1);
        ways.set(next, 0);
        queue.push(next);
      }

      if (dist.get(next) === dist.get(node) + 1) {
        ways.set(next, ways.get(next) + ways.get(node));
      }
    });
  }

  return ways.get(target) || 0;
}

function countOverlapping(text, block) {
  let count = 0;

  for (let i = 0; i + block.length <= text.length; i += 1) {
    if (text.slice(i, i + block.length) === block) count += 1;
  }

  return count;
}

function caesarShift(word, shift) {
  return word.replace(/[A-Z]/g, letter => String.fromCharCode(((letter.charCodeAt(0) - 65 + shift + 26 * 10) % 26) + 65));
}

function pythonRange(start, stop, step) {
  const out = [];
  if (step === 0) throw new Error("range() step must not be zero");
  for (let i = start; step > 0 ? i < stop : i > stop; i += step) out.push(i);
  return out;
}

// Swift stride(from:to:by:) excludes the "to" bound, like Python's range().
function swiftStrideTo(from, to, by) {
  return pythonRange(from, to, by);
}

module.exports = {
  must,
  numberWord,
  gridShortestPath,
  countInversions,
  cheapestCost,
  countShortestPaths,
  countOverlapping,
  caesarShift,
  pythonRange,
  swiftStrideTo
};
