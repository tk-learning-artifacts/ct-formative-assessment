// Solvers for backend/content/questions/core.json.
//
// Each solver receives the question and returns either a value (matched
// against the option text: exact text, case-insensitive, or the option's
// leading number) or { pick: optionText => boolean }. The answer-key test then
// requires exactly one option to match, and that option to be the key.

const {
  must,
  numberWord,
  gridShortestPath,
  countInversions,
  cheapestCost,
  countShortestPaths,
  countOverlapping,
  caesarShift
} = require("./lib");

module.exports = {
  "P5-01": q => {
    // The box must still be open for every "Put ... into the box" step.
    const steps = {};
    [...q.prompt.matchAll(/^(\d+)\) (.+)$/gm)].forEach(([, n, text]) => { steps[n] = text; });
    const closeStep = must(Object.keys(steps).find(n => /close/i.test(steps[n])), "a close step");
    const putSteps = Object.keys(steps).filter(n => /^put /i.test(steps[n]));

    return {
      pick: option => {
        const order = option.split(",").map(part => part.trim());
        const complete = order.length === Object.keys(steps).length && new Set(order).size === order.length;
        return complete && putSteps.every(n => order.indexOf(n) < order.indexOf(closeStep));
      }
    };
  },

  "P5-02": q => {
    const line = must(q.prompt.split("\n").find(text => text.includes("...")), "the pattern line");
    const items = line.split(",").map(item => item.trim()).filter(item => item && item !== "...");
    const period = [...Array(items.length).keys()].map(i => i + 1)
      .find(p => items.every((item, i) => item === items[i % p]));
    const position = Number(must(q.prompt.match(/(\d+)(?:st|nd|rd|th) sticker/), "the asked position")[1]);
    return items[(position - 1) % period];
  },

  "P5-03": q => {
    const [, values, special] = must(q.prompt.match(/If the number is ([\d, or]+), you get an? (\w+) ticket/), "the if rule");
    const otherwise = must(q.prompt.match(/Otherwise, you get an? (\w+) ticket/), "the otherwise rule")[1];
    const roll = Number(must(q.prompt.match(/You roll an? (\d+)/), "the roll")[1]);
    const specialValues = values.match(/\d+/g).map(Number);
    return specialValues.includes(roll) ? special : otherwise;
  },

  "P5-04": q => {
    const [, start, direction, times] = must(
      q.prompt.match(/points (\w+)\. You turn it (right|left) \([a-z]+\) (\w+(?: times)?)\./i),
      "the rotation"
    );
    const compass = ["UP", "RIGHT", "DOWN", "LEFT"];
    const turn = direction.toLowerCase() === "right" ? 1 : -1;
    const index = (compass.indexOf(start.toUpperCase()) + turn * numberWord(times) + 40) % 4;
    return compass[index];
  },

  "P5-05": q => {
    const switches = Number(must(q.prompt.match(/You have (\d+) light switches/), "the switch count")[1]);
    must(q.prompt.match(/can be ON or OFF/), "two states per switch");
    return 2 ** switches;
  },

  "P6-01": q => gridShortestPath(must(q.art, "the grid art")),

  "P6-02": q => {
    const start = Number(must(q.prompt.match(/starts at (\d+) points/), "the start")[1]);
    const times = Number(must(q.prompt.match(/repeats (\d+) times/), "the repeat count")[1]);
    const add = Number(must(q.prompt.match(/Add (\d+) points/), "the step")[1]);
    let total = start;
    for (let i = 0; i < times; i += 1) total += add;
    return total;
  },

  "P6-03": q => {
    const values = must(q.prompt.match(/You have: ([\d ]+)\n/), "the starting order")[1].trim().split(/\s+/).map(Number);
    return countInversions(values);
  },

  "P6-04": q => {
    const normal = Number(must(q.prompt.match(/Correct answer: \+(\d+)/), "the normal points")[1]);
    const [, limit, bonus] = must(q.prompt.match(/in under (\d+) seconds, you get \+(\d+) total/), "the bonus rule");
    const seconds = Number(must(q.prompt.match(/You answer correctly in (\d+) seconds/), "the answer time")[1]);
    return seconds < Number(limit) ? Number(bonus) : normal;
  },

  "P6-05": q => {
    const adjacency = {};
    [...q.prompt.matchAll(/^(\w) can connect to (.+)\.$/gm)].forEach(([, from, targets]) => {
      adjacency[from] = targets.split(/,|\band\b/).map(item => item.trim()).filter(Boolean);
    });
    const [, source, target] = must(q.prompt.match(/from (\w) to (\w)\?/), "the route endpoints");
    return countShortestPaths(adjacency, source, target);
  },

  "S1-01": q => {
    must(q.prompt.match(/If A > B, return A\nElse return B/), "the rule");
    const [, a, b] = must(q.prompt.match(/A = (\d+) and B = (\d+)/), "the inputs");
    const firstLineRuns = Number(a) > Number(b);
    return { pick: option => (firstLineRuns ? /first line/i : /else line/i).test(option) };
  },

  "S1-02": q => 2 ** Number(must(q.prompt.match(/exactly (\d+) bits/), "the bit count")[1]),

  "S1-03": q => {
    let value = Number(must(q.prompt.match(/Start with the number (\d+)/), "the start")[1]);
    const times = Number(must(q.prompt.match(/Repeat exactly (\d+) times/), "the repeat count")[1]);
    const divisor = Number(must(q.prompt.match(/even, divide by (\d+)/), "the even rule")[1]);
    const addend = Number(must(q.prompt.match(/odd, add (\d+)/), "the odd rule")[1]);
    for (let i = 0; i < times; i += 1) value = value % 2 === 0 ? value / divisor : value + addend;
    return value;
  },

  "S1-04": q => {
    const [, w, h, bits] = must(q.prompt.match(/(\d+)×(\d+) .*? uses (\d+) bits? per pixel/), "the image size");
    return Number(w) * Number(h) * Number(bits);
  },

  "S1-05": q => {
    must(q.prompt.match(/if you have a PASS OR you are with a TEACHER/), "the OR rule");
    const hasPass = !/You have no pass/i.test(q.prompt);
    const withTeacher = /you are with a teacher\./i.test(q.prompt);
    return hasPass || withTeacher ? "Yes" : "No";
  },

  "S2-01": q => {
    const n = Number(must(q.prompt.match(/A list has (\d+) names/), "the list size")[1]);
    const linearWorst = n;
    const halvingWorst = Math.floor(Math.log2(n)) + 1;
    if (halvingWorst === linearWorst) return "Same";
    return halvingWorst < linearWorst ? "B" : "A";
  },

  "S2-02": q => {
    const edges = [...q.prompt.matchAll(/(\w)→(\w) \((\d+)\)/g)].map(([, from, to, cost]) => ({ from, to, cost: Number(cost) }));
    must(edges.length, "the edge list");
    const [, source, target] = must(q.prompt.match(/from (\w) to (\w)\?/), "the route endpoints");
    return cheapestCost(edges, source, target);
  },

  "S2-03": q => {
    const tiles = Number(must(q.prompt.match(/You have (\d+) tiles in a row, all WHITE/), "the tile count")[1]);
    const flip = Number(must(q.prompt.match(/flips exactly (\d+) neighbouring tiles/), "the move size")[1]);
    const window = (1 << flip) - 1;
    const seen = new Set([0]);
    const queue = [0];

    while (queue.length) {
      const state = queue.shift();
      for (let i = 0; i + flip <= tiles; i += 1) {
        const next = state ^ (window << i);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }

    const reachableBlackCounts = new Set([...seen].map(state => state.toString(2).split("1").length - 1));
    return {
      pick: option => {
        const match = option.match(/^(\d+) black tiles?$/);
        return Boolean(match) && !reachableBlackCounts.has(Number(match[1]));
      }
    };
  },

  "S2-04": q => {
    const code = must(q.prompt.match(/A code is: (\w+)/), "the code")[1];
    const block = must(q.prompt.match(/the block '(\w+)'/), "the block")[1];
    must(q.prompt.match(/overlaps ARE allowed/), "the overlap rule");
    return countOverlapping(code, block);
  },

  "S2-05": q => {
    const shift = Number(must(q.prompt.match(/shifts forward by (\d+)/), "the shift")[1]);
    const coded = must(q.prompt.match(/The coded word is: (\w+)/), "the coded word")[1];
    return caesarShift(coded, -shift);
  }
};
