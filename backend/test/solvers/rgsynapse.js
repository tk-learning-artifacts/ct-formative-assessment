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
  },

  "RGS-S1-03": q => {
    expectSource(q, ["a = 1", "b = a + 1", "a = 5", "print(b)"].join("\n"));

    const a = 1;
    const b = a + 1;
    // a is reassigned to 5 afterwards, but b was already computed and does not change.
    return b;
  },

  "RGS-S1-04": q => {
    expectSource(q, [
      "def on_key_a():",
      "    print(\"A\")",
      "",
      "def on_key_b():",
      "    print(\"B\")",
      "",
      "on_key_b()",
      "on_key_a()"
    ].join("\n"));

    // Handlers run in the order they are called, not the order they are defined.
    return "B\nA";
  },

  "RGS-S1-05": q => {
    expectSource(q, [
      "score_a = 0",
      "score_b = 0",
      "",
      "def add_a():",
      "    global score_a",
      "    score_a += 1",
      "",
      "def add_b():",
      "    global score_b",
      "    score_b += 1"
    ].join("\n"));

    // add_a and add_b never touch each other's variable, so the result depends
    // only on how many times each was called (twice and once), not the order.
    return "2 1";
  },

  "RGS-S1-06": q => {
    expectSource(q, ["x = 5", "y = 0", "print(x > 3 or y == 1 and x < 3)"].join("\n"));

    const x = 5;
    const y = 0;
    return x > 3 || (y === 1 && x < 3);
  },

  "RGS-S1-07": q => {
    expectSource(q, [
      "func rectangleArea(_ w: Double, _ h: Double) -> Double {",
      "    return w * h",
      "}"
    ].join("\n"));

    const testSides = [3, 5];

    return {
      pick: option => {
        const call = must(option.match(/rectangleArea\(([^)]*)\)/), `a rectangleArea(...) call in "${option}"`);
        const args = call[1].split(",").map(part => part.trim());
        if (args.length !== 2) return false;

        return testSides.every(s => {
          const values = args.map(arg => (arg === "s" ? s : Number(arg)));
          return values[0] * values[1] === s * s;
        });
      }
    };
  },

  "RGS-S1-08": q => ({
    // Judgement question about decomposition order, checked by rule: the
    // correct prompt introduces the single-answer check before the loop that
    // depends on it.
    pick: option => {
      const text = option.toLowerCase();
      const checkIndex = text.indexOf("checks whether one answer is correct");
      const loopIndex = text.indexOf("loop");
      return checkIndex !== -1 && loopIndex !== -1 && checkIndex < loopIndex;
    }
  }),

  "RGS-S1-09": q => {
    expectSource(q, [
      "def is_even(n):",
      "    if n % 2 = 0:",
      "        return True",
      "    else:",
      "        return False"
    ].join("\n"));

    must(q.code.source.match(/if n % 2 = 0:/), "the single '=' bug");
    return "It uses = instead of ==, so the code will not even run";
  },

  "RGS-S1-10": q => {
    expectSource(q, [
      "def count_vowels(word):",
      "    count = 0",
      "    for letter in word:",
      "        if letter in \"aeiou\":",
      "            count += 1",
      "    return count"
    ].join("\n"));

    const buggyCount = word => [...word].filter(ch => "aeiou".includes(ch)).length;
    const trueCount = word => [...word].filter(ch => "aeiouAEIOU".includes(ch)).length;

    return { pick: option => buggyCount(option) !== trueCount(option) };
  },

  "RGS-S1-11": q => {
    expectSource(q, "print(5 // 2)");

    const value = Math.floor(5 / 2);
    return {
      pick: option => {
        const leading = option.match(/^-?\d+(\.\d+)?/);
        return leading !== null && Number(leading[0]) === value;
      }
    };
  },

  "RGS-S2-03": q => {
    expectSource(q, [
      "nums = [5, 2, 4, 1]",
      "for i in range(len(nums) - 1):",
      "    if nums[i] > nums[i + 1]:",
      "        nums[i], nums[i + 1] = nums[i + 1], nums[i]",
      "print(nums)"
    ].join("\n"));

    const nums = [5, 2, 4, 1];
    for (let i = 0; i < nums.length - 1; i += 1) {
      if (nums[i] > nums[i + 1]) {
        const tmp = nums[i];
        nums[i] = nums[i + 1];
        nums[i + 1] = tmp;
      }
    }

    return `[${nums.join(", ")}]`;
  },

  "RGS-S2-04": q => {
    expectSource(q, [
      "events = []",
      "",
      "def on_a():",
      "    events.append(\"A\")",
      "    on_b()",
      "",
      "def on_b():",
      "    events.append(\"B\")",
      "",
      "on_a()",
      "on_b()",
      "print(events)"
    ].join("\n"));

    const events = [];
    function onB() { events.push("B"); }
    function onA() { events.push("A"); onB(); }
    onA();
    onB();

    return `[${events.map(e => `'${e}'`).join(", ")}]`;
  },

  "RGS-S2-05": q => {
    must(q.art && q.art.includes("Step 1: step_a reads counter (sees 0)"), "step 1 of the interleaving trace");
    must(q.art && q.art.includes("Step 2: step_b reads counter (sees 0)"), "step 2 of the interleaving trace");
    must(q.art && q.art.includes("Step 3: step_a writes counter = 0 + 1"), "step 3 of the interleaving trace");
    must(q.art && q.art.includes("Step 4: step_b writes counter = 0 + 1"), "step 4 of the interleaving trace");

    // Both steps read counter while it is still 0, so both write 1: one
    // increment is lost.
    return 1;
  },

  "RGS-S2-06": q => {
    expectSource(q, ["x = 0", "result = not x == 5", "print(result)"].join("\n"));

    const x = 0;
    return !(x === 5);
  },

  "RGS-S2-07": q => ({
    // Judgement question about the experiment-and-iterate cycle, checked by
    // rule: the correct option both tests against a hand-worked example and
    // tests again after a targeted fix.
    pick: option => {
      const text = option.toLowerCase();
      return text.includes("test it against") && text.includes("test again");
    }
  }),

  "RGS-S2-08": q => {
    const examples = [[1, 0.3048], [2, 0.6096], [3, 0.9144]];
    const ratio = examples[0][1] / examples[0][0];
    examples.forEach(([feet, metres]) => {
      must(Math.abs(metres - feet * ratio) < 1e-9, "a consistent linear pattern across the examples");
    });

    const value = 10 * ratio;
    return {
      pick: option => {
        const leading = option.match(/^-?\d+(\.\d+)?/);
        return leading !== null && Math.abs(Number(leading[0]) - value) < 1e-6;
      }
    };
  },

  "RGS-S2-10": q => {
    expectSource(q, [
      "def is_valid_password(pw):",
      "    if len(pw) >= 8:",
      "        return True",
      "    for ch in pw:",
      "        if ch.isdigit():",
      "            return True",
      "    return False"
    ].join("\n"));

    const code = pw => pw.length >= 8 || [...pw].some(ch => /[0-9]/.test(ch));
    const spec = pw => pw.length >= 8 && [...pw].some(ch => /[0-9]/.test(ch));

    return { pick: option => code(option) !== spec(option) };
  },

  "RGS-S2-11": q => {
    expectSource(q, ["def reversed_list(nums):", "    nums.reverse()"].join("\n"));

    // The precise fix is the one that names the missing return statement.
    return { pick: option => /\breturn\b/i.test(option) };
  },

  "RGS-S2-12": q => {
    expectSource(q, [
      "def dedupe(items):",
      "    seen = set()",
      "    result = []",
      "    for item in items:",
      "        if item not in seen:",
      "            result.append(item)",
      "    return result"
    ].join("\n"));

    const items = [1, 2, 2, 3, 1];
    const seen = new Set(); // bug: never added to, so nothing is ever filtered
    const result = [];
    items.forEach(item => {
      if (!seen.has(item)) result.push(item);
    });

    return `[${result.join(", ")}]`;
  }
};
