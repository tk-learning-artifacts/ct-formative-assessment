// Solvers for backend/content/questions/rgsynapse.json.
//
// Python and Swift are not run here (Docker and CI images have neither). A
// solver either parses the numbers it needs out of the code, or pins the exact
// source it re-implements with expectSource(), so changing the code without
// updating the solver fails loudly.

const { must, pythonRange, swiftStrideTo } = require("./lib");

function expectSource(q, expected) {
  if (q.code.source !== expected) {
    throw new Error(`${q.id}: code changed; update the solver's JavaScript translation to match`);
  }
}

module.exports = {
  "RGS-S1-01": q => {
    expectSource(q, [
      "total = 0",
      "for i in range(1, 6):",
      "    if i % 2 == 0:",
      "        total += i",
      "    else:",
      "        total -= 1",
      "print(total)"
    ].join("\n"));

    let total = 0;
    pythonRange(1, 6, 1).forEach(i => {
      if (i % 2 === 0) total += i;
      else total -= 1;
    });
    return total;
  },

  "RGS-S1-02": q => {
    expectSource(q, [
      "def largest(nums):",
      "    best = 0",
      "    for n in nums:",
      "        if n > best:",
      "            best = n",
      "    return best"
    ].join("\n"));

    const buggyLargest = nums => {
      let best = 0;
      nums.forEach(n => { if (n > best) best = n; });
      return best;
    };

    // An input "shows the bug" when the AI's function disagrees with max().
    return {
      pick: option => {
        const nums = JSON.parse(option);
        return buggyLargest(nums) !== Math.max(...nums);
      }
    };
  },

  "RGS-S2-01": q => {
    const [, from, to, by] = must(q.code.source.match(/stride\(from: (-?\d+), to: (-?\d+), by: (-?\d+)\)/), "the Swift stride");
    const expected = JSON.stringify(swiftStrideTo(Number(from), Number(to), Number(by)));

    return {
      pick: option => {
        const [, start, stop, step] = must(option.match(/range\((-?\d+), (-?\d+), (-?\d+)\)/), `a range() in option "${option}"`);
        return JSON.stringify(pythonRange(Number(start), Number(stop), Number(step))) === expected;
      }
    };
  },

  "RGS-S2-02": q => {
    const src = q.code.source;
    const scores = JSON.parse(must(src.match(/scores = (\[[\d, ]+\])/), "the scores list")[1]);
    const startIndex = Number(must(src.match(/for i in range\((\d+), len\(scores\)\):/), "the loop header")[1]);
    const threshold = Number(must(src.match(/if scores\[i\] >= (\d+):/), "the threshold")[1]);
    must(src.match(/count \+= 1\nprint\(count\)$/), "the count and print lines");

    let count = 0;
    pythonRange(startIndex, scores.length, 1).forEach(i => {
      if (scores[i] >= threshold) count += 1;
    });
    return count;
  }
};
