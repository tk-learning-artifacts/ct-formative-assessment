// Solvers for backend/content/questions/type-samples.json.
//
// A code-trace solver returns the program's output, computed by a JavaScript
// translation of the pinned source. A Parsons solver gets the program built
// from one accepted order of lines and returns its output; it pins every
// source it knows, so a new alternative order or an edited line needs a
// deliberate update here. answer-keys.test.js also runs the real programs
// under python3 and swift when those are installed.

const { pythonRange, swiftStrideTo } = require("./lib");

function expectSource(q, source, expected) {
  if (!expected.includes(source)) {
    throw new Error(`${q.id}: code changed; update the solver's JavaScript translation to match`);
  }
}

function lines(...parts) {
  return parts.join("\n");
}

module.exports = {
  "TS-CT-01": q => {
    expectSource(q, q.code.source, [lines(
      "x = 1",
      "for step in range(4):",
      "    x = x * 2",
      "    print(x)"
    )]);

    const out = [];
    let x = 1;
    pythonRange(0, 4, 1).forEach(() => {
      x *= 2;
      out.push(String(x));
    });
    return out.join("\n");
  },

  "TS-CT-02": q => {
    expectSource(q, q.code.source, [lines(
      "words = [\"loop\", \"if\", \"list\", \"print\"]",
      "count = 0",
      "for w in words:",
      "    if len(w) > 2:",
      "        count += 1",
      "        print(w.upper(), count)"
    )]);

    const out = [];
    let count = 0;
    ["loop", "if", "list", "print"].forEach(w => {
      if (w.length > 2) {
        count += 1;
        out.push(`${w.toUpperCase()} ${count}`);
      }
    });
    return out.join("\n");
  },

  "TS-CT-03": q => {
    expectSource(q, q.code.source, [lines(
      "def shout(word, times):",
      "    return (word + \"!\") * times",
      "",
      "result = []",
      "for n in range(1, 4):",
      "    result.append(shout(\"go\", n))",
      "print(result)",
      "print(len(result[-1]))"
    )]);

    const shout = (word, times) => (word + "!").repeat(times);
    const result = pythonRange(1, 4, 1).map(n => shout("go", n));
    // Python prints a list of strings with single quotes and ", " between.
    const shown = `[${result.map(s => `'${s}'`).join(", ")}]`;
    return lines(shown, String(result[result.length - 1].length));
  },

  "TS-PA-01": (q, source) => {
    expectSource(q, source, [lines(
      "count = 3",
      "while count > 0:",
      "    print(count)",
      "    count = count - 1",
      "print(\"Go!\")"
    )]);

    const out = [];
    let count = 3;
    while (count > 0) {
      out.push(String(count));
      count -= 1;
    }
    out.push("Go!");
    return out.join("\n");
  },

  // The two setup lines are independent, so both orders run the same code.
  "TS-PA-02": (q, source) => {
    const body = ["for n in nums:", "    if n % 2 == 0:", "        total += n", "print(total)"];
    expectSource(q, source, [
      lines("nums = [4, 7, 10, 3]", "total = 0", ...body),
      lines("total = 0", "nums = [4, 7, 10, 3]", ...body)
    ]);

    let total = 0;
    [4, 7, 10, 3].forEach(n => {
      if (n % 2 === 0) total += n;
    });
    return String(total);
  },

  // The Swift program must print what the Python one in `code` prints.
  "TS-PA-03": (q, source) => {
    expectSource(q, q.code.source, [lines(
      "total = 0",
      "for i in range(1, 5):",
      "    total += i * i",
      "print(total)"
    )]);
    expectSource(q, source, [lines(
      "var total = 0",
      "for i in 1...4 {",
      "    total += i * i",
      "}",
      "print(total)"
    )]);

    let python = 0;
    pythonRange(1, 5, 1).forEach(i => { python += i * i; });

    // 1...4 is closed: the same as stride(from: 1, to: 5, by: 1).
    let swift = 0;
    swiftStrideTo(1, 5, 1).forEach(i => { swift += i * i; });

    if (python !== swift) {
      throw new Error(`${q.id}: the Swift translation prints ${swift}, the Python prints ${python}`);
    }
    return String(swift);
  }
};
