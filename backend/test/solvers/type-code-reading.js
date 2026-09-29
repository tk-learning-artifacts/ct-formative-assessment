// Checks for backend/content/questions/type-code-reading.json.
//
// A code-reading option is a claim about behaviour ("gives back the biggest
// number"), so its solver runs the code rather than parsing the option. Each
// spec below pins the question's exact source and gives:
//   run(input)      a JavaScript translation of the code
//   inputs          inputs chosen so that every wrong description fails on
//                   at least one of them
//   claims          option text -> (input, output) => whether the output
//                   is what that description promises
//   followUp        for kind "choice": option text -> () => whether that
//                   option is right, computed with run();
//                   for kind "line": { line, replace, runFixed, goal }. The
//                   code with that one line replaced must meet goal on every
//                   input and the original must not. When more than one
//                   line can be fixed on its own, give
//                   { fixes: [{ line, replace, runFixed }], goal } instead;
//                   every fix must work, and the key lists their lines.
//   call(input)     optional: the input as a call in the code's own
//                   language, so code-reading.test.js can run the real
//                   program under python3 or swift and compare it with run().
//
// The solver returns { pick } for the description, like an mcq solver, and
// { pick } or { lines } for the follow-up; answer-keys.test.js requires
// exactly one option to match and that it is the key. An option with no
// claim (its text was edited) throws, so the claim is written again.
//
// A question with a figure (ADR 0007) reads its follow-up's input from the
// figure (the list drawn, the rows to pick from, the bar to snap) or checks
// the figure against the code (a flowchart of the same steps, a table of
// examples), so the answer-key test's stripped figure makes it throw.
//
// The open-response-ai questions in the same bank are checked like those in
// ai-samples.js: their solvers return the facts the full-credit criterion
// names.

const { must, agree } = require("./lib");

function lines(...parts) {
  return parts.join("\n");
}

function expectSource(q, expected) {
  if (q.code.source !== expected) {
    throw new Error(`${q.id}: code changed; update the solver's JavaScript translation to match`);
  }
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function numbersIn(text) {
  return (text.match(/-?\d+/g) || []).map(Number);
}

function withLine(source, line, replace) {
  const all = source.split("\n");
  all[line - 1] = replace;
  return all.join("\n");
}

function firstArgmax(scores) {
  let bestName = null;
  let best = -Infinity;
  Object.entries(scores).forEach(([name, points]) => {
    if (points > best) {
      best = points;
      bestName = name;
    }
  });
  return bestName;
}

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

const SPECS = {
  "CR-P5-01": {
    source: lines(
      "when green flag clicked",
      "set biggest to item 1 of numbers",
      "for each n in numbers",
      "    if n > biggest then",
      "        set biggest to n",
      "    end",
      "end",
      "say biggest"
    ),
    run: numbers => {
      let biggest = numbers[0];
      numbers.forEach(n => {
        if (n > biggest) {
          biggest = n;
        }
      });
      return biggest;
    },
    inputs: [[3, 8, 2], [9, 1, 4], [1, 2, 7], [5, 5, 5, 5], [4]],
    claims: {
      "The first number in the list": (xs, out) => out === xs[0],
      "The biggest number in the list": (xs, out) => out === Math.max(...xs),
      "The last number in the list": (xs, out) => out === xs[xs.length - 1],
      "How many numbers are in the list": (xs, out) => out === xs.length
    },
    followUp: (q, run) => {
      const target = Number(q.followUp.prompt.match(/say (\d+)/)[1]);
      return option => run(numbersIn(option)) === target;
    }
  },

  "CR-P6-01": {
    source: lines(
      "set count to 0",
      "for each letter in word",
      "    if letter is a vowel then",
      "        change count by 1",
      "    end",
      "end",
      "say count"
    ),
    run: word => Array.from(word).filter(letter => VOWELS.has(letter)).length,
    inputs: ["banana", "sky", "idea", "cat", "a"],
    claims: {
      "How many vowels are in the word": (word, out) => out === Array.from(word).filter(l => VOWELS.has(l)).length,
      "How many letters are in the word": (word, out) => out === word.length,
      "Whether the word has a vowel in it (1 for yes, 0 for no)": (word, out) => out === (Array.from(word).some(l => VOWELS.has(l)) ? 1 : 0),
      "How many letters in the word are not vowels": (word, out) => out === Array.from(word).filter(l => !VOWELS.has(l)).length
    },
    followUp: {
      line: 3,
      replace: "    if letter is not a vowel then",
      runFixed: word => Array.from(word).filter(letter => !VOWELS.has(letter)).length,
      goal: (word, out) => out === Array.from(word).filter(l => !VOWELS.has(l)).length
    }
  },

  "CR-S1-01": {
    source: lines(
      "set result to an empty list",
      "for each item in the list, from first to last",
      "    put item at the front of result",
      "end",
      "show result"
    ),
    run: list => {
      const result = [];
      list.forEach(item => result.unshift(item));
      return result;
    },
    inputs: [[1, 2, 3], [5, 1, 4], [7], [2, 2, 9]],
    claims: {
      "The list sorted from smallest to largest": (xs, out) => sameValue(out, xs.slice().sort((a, b) => a - b)),
      "The list in the same order": (xs, out) => sameValue(out, xs),
      "The list in reverse order": (xs, out) => sameValue(out, xs.slice().reverse()),
      "Only the first item of the list": (xs, out) => sameValue(out, xs.slice(0, 1))
    },
    followUp: (_q, run) => option => sameValue(run(numbersIn(option)), numbersIn(option))
  },

  "CR-S2-01": {
    source: lines(
      "function find(list, target)",
      "    set position to 1",
      "    repeat while position ≤ length of list",
      "        if item position of list = target then",
      "            return position",
      "        end",
      "        change position by 1",
      "    end",
      "    return 0",
      "end"
    ),
    run: ([list, target]) => {
      for (let position = 1; position <= list.length; position += 1) {
        if (list[position - 1] === target) {
          return position;
        }
      }
      return 0;
    },
    inputs: [[[4, 7, 4], 4], [[3, 5], 5], [[2, 4, 6], 3], [[9], 9], [[], 1]],
    claims: {
      "How many items are equal to target": ([xs, t], out) => out === xs.filter(x => x === t).length,
      "The position of the last item equal to target, or 0 if there is none": ([xs, t], out) => out === xs.lastIndexOf(t) + 1,
      "1 if target is in the list, 0 if it is not": ([xs, t], out) => out === (xs.includes(t) ? 1 : 0),
      "The position of the first item equal to target, or 0 if there is none": ([xs, t], out) => out === xs.indexOf(t) + 1
    },
    followUp: (_q, run) => option => {
      const match = option.match(/^find\(\[([^\]]*)\],\s*(-?\d+)\)$/);
      if (!match) {
        throw new Error(`CR-S2-01: cannot read the call ${option}`);
      }
      return run([numbersIn(match[1]), Number(match[2])]) === 0;
    }
  },

  "CR-RGS-S1-01": {
    source: lines(
      "def tidy(words):",
      "    result = []",
      "    for w in words:",
      "        if w not in result:",
      "            result.append(w)",
      "    return result"
    ),
    run: words => {
      const result = [];
      words.forEach(w => {
        if (!result.includes(w)) {
          result.push(w);
        }
      });
      return result;
    },
    inputs: [["b", "a", "b"], ["cat", "dog"], ["x", "y", "x", "z"], []],
    call: words => `tidy(${JSON.stringify(words)})`,
    claims: {
      "The words with repeats removed, each kept where it first appears": (ws, out) => sameValue(out, ws.filter((w, i) => ws.indexOf(w) === i)),
      "The words with repeats removed, each kept where it last appears": (ws, out) => sameValue(out, ws.filter((w, i) => ws.lastIndexOf(w) === i)),
      "The words sorted into alphabetical order": (ws, out) => sameValue(out, ws.slice().sort()),
      "Only the words that appear more than once": (ws, out) => sameValue(out, ws.filter((w, i) => ws.indexOf(w) === i && ws.lastIndexOf(w) !== i))
    },
    followUp: (_q, run) => option => {
      const words = JSON.parse(option);
      return run(words).length === words.length;
    }
  },

  "CR-RGS-S1-02": {
    source: lines(
      "func check(_ scores: [Int]) -> Bool {",
      "    for s in scores {",
      "        if s < 50 {",
      "            return false",
      "        }",
      "    }",
      "    return true",
      "}"
    ),
    run: scores => scores.every(s => !(s < 50)),
    inputs: [[60, 40], [40, 60], [70, 80], [10], [50], []],
    call: scores => `check(${JSON.stringify(scores)})`,
    claims: {
      "true if at least one score is 50 or more": (xs, out) => out === xs.some(s => s >= 50),
      "true if the first score is 50 or more": (xs, out) => out === (xs.length > 0 && xs[0] >= 50),
      "true only if every score is below 50": (xs, out) => out === xs.every(s => s < 50),
      "true only if every score is 50 or more": (xs, out) => out === xs.every(s => s >= 50)
    },
    // Only "true" and "false" are values check() can give back; it neither
    // crashes nor returns nil (its return type is Bool, not Bool?).
    followUp: (_q, run) => option => option === String(run([]))
  },

  "CR-RGS-S2-01": {
    source: lines(
      "def top_scorer(scores):",
      "    best_name = None",
      "    best = 0",
      "    for name, points in scores.items():",
      "        if points > best:",
      "            best = points",
      "            best_name = name",
      "    return best_name"
    ),
    run: scores => {
      let bestName = null;
      let best = 0;
      Object.entries(scores).forEach(([name, points]) => {
        if (points > best) {
          best = points;
          bestName = name;
        }
      });
      return bestName;
    },
    inputs: [{ Ana: 12, Bo: 9 }, { Ana: 5, Bo: 5 }, { Cy: -3, Di: -1 }, { Ed: 0 }, { Fa: 2, Gu: 7, Ha: 7 }],
    call: scores => `top_scorer(${JSON.stringify(scores)})`,
    claims: {
      "Gives back the highest score itself, not a name": (s, out) => out === Math.max(...Object.values(s)),
      "Gives back the name with the most points; if two tie, the one listed last": (s, out) => {
        const max = Math.max(...Object.values(s));
        return out === Object.keys(s).filter(name => s[name] === max).pop();
      },
      "Gives back the name with the most points (the first listed if two tie), but None if nobody scored more than 0": (s, out) => (
        Math.max(...Object.values(s)) > 0 ? out === firstArgmax(s) : out === null
      ),
      "Gives back the name with the most points for any scores, negative ones included": (s, out) => out === firstArgmax(s)
    },
    // Either line fixes it alone: start best below any score, or let the
    // first name through whatever its score.
    followUp: {
      fixes: [
        { line: 3, replace: "    best = float(\"-inf\")", runFixed: scores => firstArgmax(scores) },
        { line: 5, replace: "        if best_name is None or points > best:", runFixed: scores => firstArgmax(scores) }
      ],
      goal: (s, out) => out === firstArgmax(s)
    }
  },

  "CR-RGS-S2-02": {
    source: lines(
      "def squash(text):",
      "    out = \"\"",
      "    i = 0",
      "    while i < len(text):",
      "        j = i",
      "        while j < len(text) and text[j] == text[i]:",
      "            j += 1",
      "        out += text[i] + str(j - i)",
      "        i = j",
      "    return out"
    ),
    run: text => {
      let out = "";
      let i = 0;
      while (i < text.length) {
        let j = i;
        while (j < text.length && text[j] === text[i]) {
          j += 1;
        }
        out += text[i] + String(j - i);
        i = j;
      }
      return out;
    },
    inputs: ["aaab", "aaba", "abca", "zz", "", "mississippi"],
    call: text => `squash(${JSON.stringify(text)})`,
    claims: {
      "Each letter with how many times it appears anywhere in the text": (t, out) => {
        const counts = new Map();
        Array.from(t).forEach(ch => counts.set(ch, (counts.get(ch) || 0) + 1));
        return out === Array.from(counts).map(([ch, n]) => ch + n).join("");
      },
      "Each run of the same letter in a row, written as the letter and the length of the run": (t, out) => (
        out === (t.match(/(.)\1*/g) || []).map(run => run[0] + run.length).join("")
      ),
      "The text with repeated letters removed": (t, out) => out === Array.from(new Set(t)).join(""),
      "Each letter followed by its position in the text": (t, out) => out === Array.from(t).map((ch, i) => ch + i).join("")
    },
    followUp: (_q, run) => option => {
      const text = JSON.parse(option);
      return run(text).length > text.length;
    }
  },
  // ---------- Questions with figures ----------

  // The follow-up reads the heights from the figure.
  "CR-P6-02": {
    source: lines(
      "set ups to 0",
      "for each number after the first",
      "    if it > the one before then",
      "        change ups by 1",
      "    end",
      "end",
      "say ups"
    ),
    run: numbers => numbers.filter((n, i) => i > 0 && n > numbers[i - 1]).length,
    inputs: [[3, 5, 5, 2, 6, 7, 1], [1, 2, 3], [5, 4, 3], [2, 2, 2], [4, 9, 1, 8], [7]],
    claims: {
      "How many numbers are bigger than the first number": (xs, out) => out === xs.filter(n => n > xs[0]).length,
      "The biggest number in the list": (xs, out) => out === Math.max(...xs),
      "How many times a number is bigger than the one just before it": (xs, out) => {
        let ups = 0;
        for (let i = 1; i < xs.length; i += 1) {
          if (xs[i] > xs[i - 1]) ups += 1;
        }
        return out === ups;
      },
      "How many numbers there are, not counting the first": (xs, out) => out === xs.length - 1
    },
    followUp: (q, run) => {
      const heights = figureCells(q, "cells")[0].map(Number);
      return option => run(heights) === Number(option);
    }
  },

  // The follow-up's rows are drawn in the figure, one per option.
  "CR-S1-02": {
    source: lines(
      "set in_order to true",
      "for each i from 1 to length - 1",
      "    if item i ≥ item i + 1 then",
      "        set in_order to false",
      "    end",
      "end",
      "say in_order"
    ),
    run: xs => xs.every((x, i) => i === xs.length - 1 || !(x >= xs[i + 1])),
    inputs: [[2, 4, 4, 9], [1, 3, 6, 8], [1, 5, 3, 9], [3, 7, 9, 2], [5], [4, 4], [9, 1, 5]],
    claims: {
      "When the first item is the smallest": (xs, out) => out === xs.every(x => x >= xs[0]),
      "When the items never go down, even if two next to each other are equal": (xs, out) => out === xs.every((x, i) => i === 0 || x >= xs[i - 1]),
      "When the last item is the biggest": (xs, out) => out === xs.every(x => x <= xs[xs.length - 1]),
      "When every item is smaller than the one after it": (xs, out) => out === xs.every((x, i) => i === 0 || xs[i - 1] < x)
    },
    followUp: (q, run) => {
      const rows = new Map(must(q.visual && q.visual.kind === "cells" && q.visual.rows, "the rows in the figure")
        .map(row => [row.label, row.cells.map(Number)]));
      return option => run(must(rows.get(option), `the figure's ${option}`)) === true;
    }
  },

  // The figure is the same procedure drawn as a flowchart; the solver runs
  // the flowchart and requires it to agree with the pseudocode.
  "CR-S1-03": {
    source: lines(
      "set r to 0",
      "repeat until n is 0",
      "    d = the last digit of n",
"    r = r × 10 + d",
      "    remove the last digit of n",
      "end",
      "say r"
    ),
    run: n => {
      let r = 0;
      let rest = n;
      while (rest !== 0) {
        const d = rest % 10;
        r = r * 10 + d;
        rest = Math.floor(rest / 10);
      }
      return r;
    },
    inputs: [472, 50, 7, 1200, 9051, 11, 0],
    claims: {
      "The sum of the digits of n": (n, out) => out === Array.from(String(n), Number).reduce((a, b) => a + b, 0),
      "The digits of n in reverse order, as a number": (n, out) => out === Number(Array.from(String(n)).reverse().join("")),
      "The last digit of n": (n, out) => out === n % 10,
      "n multiplied by 10": (n, out) => out === n * 10
    },
    followUp: (q, run) => {
      const flow = runDigitFlowchart(q);
      [472, 50, 1200, 9051].forEach(n => agree(flow(n) === run(n), `the flowchart and the procedure for ${n}`));
      const target = Number(q.followUp.prompt.match(/say (\d+)/)[1]);
      return option => run(Number(option)) === target;
    }
  },

  // The follow-up's bar is the figure: its rows and columns of squares.
  "CR-S2-02": {
    source: lines(
      "set pieces to 1",
      "set breaks to 0",
      "repeat until each piece is 1×1",
      "    pick a piece that isn't 1×1",
      "    snap it in two along a line",
      "    change pieces by 1",
      "    change breaks by 1",
      "end",
      "say breaks"
    ),
    // input: { rows, cols, seed }. The seed decides which piece is picked
    // and where it is broken, so different inputs make different choices.
    run: ({ rows, cols, seed }) => {
      let state = seed;
      const random = n => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state % n;
      };
      const pieces = [[rows, cols]];
      let breaks = 0;
      while (pieces.some(([r, c]) => r * c > 1)) {
        const big = pieces.map((piece, i) => i).filter(i => pieces[i][0] * pieces[i][1] > 1);
        const [r, c] = pieces.splice(big[random(big.length)], 1)[0];
        const alongRows = r > 1 && (c === 1 || random(2) === 0);
        const cut = 1 + random((alongRows ? r : c) - 1);
        pieces.push(alongRows ? [cut, c] : [r, cut], alongRows ? [r - cut, c] : [r, c - cut]);
        breaks += 1;
      }
      must(pieces.length === rows * cols, "every square apart");
      return breaks;
    },
    inputs: [
      { rows: 3, cols: 4, seed: 1 },
      { rows: 3, cols: 4, seed: 7 },
      { rows: 3, cols: 4, seed: 99 },
      { rows: 1, cols: 1, seed: 3 },
      { rows: 1, cols: 6, seed: 5 },
      { rows: 5, cols: 5, seed: 11 },
      { rows: 2, cols: 7, seed: 42 }
    ],
    claims: {
      "It is always one less than the number of squares": (bar, out) => out === bar.rows * bar.cols - 1,
      "It is always half the number of squares": (bar, out) => out === bar.rows * bar.cols / 2,
      "It is always the number of rows plus the number of columns": (bar, out) => out === bar.rows + bar.cols,
      "It is always the number of squares": (bar, out) => out === bar.rows * bar.cols
    },
    followUp: (q, run) => {
      const rows = figureCells(q, "cells");
      agree(rows.every(row => row.length === rows[0].length && row.every(cell => cell === "dark")), "a whole bar of squares");
      return option => [1, 2, 3].every(seed => run({ rows: rows.length, cols: rows[0].length, seed }) === Number(option));
    }
  },

  "CR-RGS-S1-03": {
    source: lines(
      "def first_drop(temps):",
      "    for i in range(1, len(temps)):",
      "        if temps[i] < temps[i - 1]:",
      "            return i",
      "    return -1"
    ),
    run: temps => {
      for (let i = 1; i < temps.length; i += 1) {
        if (temps[i] < temps[i - 1]) return i;
      }
      return -1;
    },
    inputs: [[21, 23, 23, 20, 25, 19], [5, 4], [1, 2, 3], [3, 3, 3], [9], [], [10, 12, 7, 15, 2]],
    call: temps => `first_drop(${JSON.stringify(temps)})`,
    claims: {
      "The position of the first reading that is lower than the one just before it, or -1 if there is none": (t, out) => (
        out === t.findIndex((x, i) => i > 0 && x < t[i - 1])
      ),
      "The position of the lowest reading": (t, out) => out === (t.length ? t.indexOf(Math.min(...t)) : -1),
      "How many readings are lower than the one just before them": (t, out) => out === t.filter((x, i) => i > 0 && x < t[i - 1]).length,
      "The first reading that is lower than the one just before it, or -1 if there is none": (t, out) => (
        out === (t.find((x, i) => i > 0 && x < t[i - 1]) ?? -1)
      )
    },
    followUp: (q, run) => {
      agree(q.visual && q.visual.numberFrom === 0, "positions starting at 0");
      const temps = figureCells(q, "cells")[0].map(Number);
      return option => run(temps) === Number(option);
    }
  },

  // The table's examples must be what the code gives back.
  "CR-RGS-S2-03": {
    source: lines(
      "func shrink(_ n: Int) -> Int {",
      "    var x = n",
      "    while x >= 10 {",
      "        var sum = 0",
      "        var y = x",
      "        while y > 0 {",
      "            sum += y % 10",
      "            y /= 10",
      "        }",
      "        x = sum",
      "    }",
      "    return x",
      "}"
    ),
    run: n => {
      let x = n;
      while (x >= 10) {
        let sum = 0;
        let y = x;
        while (y > 0) {
          sum += y % 10;
          y = Math.floor(y / 10);
        }
        x = sum;
      }
      return x;
    },
    inputs: [7, 38, 405, 9999, 0, 10, 19, 29, 1234567],
    call: n => `shrink(${n})`,
    claims: {
      "It adds up the digits of n once": (n, out) => out === digitSum(n),
      "It gives back the last digit of n": (n, out) => out === n % 10,
      "It gives back how many digits n has": (n, out) => out === String(n).length,
      "It adds up the digits, then the digits of that, and so on until one digit is left": (n, out) => {
        let x = n;
        while (String(x).length > 1) x = digitSum(x);
        return out === x;
      }
    },
    followUp: (q, run) => {
      const visual = must(q.visual && q.visual.kind === "table" && q.visual, "the table of examples");
      agree(visual.columns.join("|") === "Call|Gives back", "the table's columns");
      must(visual.rows, "the examples").forEach(([call, result]) => {
        const n = Number(must(call.match(/^shrink\((\d+)\)$/), "a call in the table")[1]);
        agree(run(n) === Number(result), `shrink(${n})`);
      });
      const result = option => run(Number(must(option.match(/^shrink\((\d+)\)$/), "a call")[1]));
      return option => q.followUp.options.filter(other => other !== option).every(other => result(other) !== result(option));
    }
  }
};

function digitSum(n) {
  return Array.from(String(n), Number).reduce((a, b) => a + b, 0);
}

// The value rows of a cells figure, as the text in each box (or its fill).
function figureCells(q, kind) {
  must(q.visual && q.visual.kind === kind && Array.isArray(q.visual.rows), `the ${kind} figure`);
  return q.visual.rows.map(row => row.cells.map(cell => (typeof cell === "string" ? cell : cell.text !== undefined ? cell.text : cell.fill)));
}

// CR-S1-03's flowchart, run box by box from the start: each process box's
// text is one of the procedure's steps, and the decision's arrows are
// followed by their labels.
function runDigitFlowchart(q) {
  must(q.visual && q.visual.kind === "flowchart", "the flowchart");
  const nodes = new Map(must(q.visual.nodes, "the flowchart's boxes").map(node => [node.id, node]));
  const out = (id, label) => must(q.visual.edges.find(edge => edge.from === id && (label === undefined || edge.label === label)), `the arrow out of ${id}`).to;
  const steps = {
    "Set r to 0": s => { s.r = 0; },
    "d = the last digit of n": s => { s.d = s.n % 10; },
    "r = r × 10 + d": s => { s.r = s.r * 10 + s.d; },
    "Remove the last digit of n": s => { s.n = Math.floor(s.n / 10); }
  };

  return n => {
    const s = { n };
    let id = q.visual.nodes.find(node => node.type === "start").id;
    for (let guard = 0; guard < 1000; guard += 1) {
      const node = nodes.get(id);
      if (node.type === "end") {
        agree(node.text === "Say r", "what the flowchart says");
        return s.r;
      }
      if (node.type === "decision") {
        agree(node.text === "Is n 0?", "the flowchart's question");
        id = out(id, s.n === 0 ? "Yes" : "No");
      } else {
        if (node.type === "process") must(steps[node.text], `a known step (${node.text})`)(s);
        id = out(id);
      }
    }
    throw new Error(`${q.id}: the flowchart never ends`);
  };
}

// A line follow-up's fixes, one or several.
function lineFixes(spec) {
  return spec.followUp.fixes || [{ line: spec.followUp.line, replace: spec.followUp.replace, runFixed: spec.followUp.runFixed }];
}

function solveCodeReading(id, spec) {
  return q => {
    expectSource(q, spec.source);

    const describe = {
      pick: option => {
        const claim = spec.claims[option];
        if (!claim) {
          throw new Error(`${id}: no claim for the option ${JSON.stringify(option)}; write one in solvers/type-code-reading.js`);
        }
        return spec.inputs.every(input => claim(input, spec.run(input)));
      }
    };

    if (typeof spec.followUp === "function") {
      return { describe, followUp: { pick: spec.followUp(q, spec.run) } };
    }

    const { goal } = spec.followUp;
    const fixes = lineFixes(spec);
    const originalFails = spec.inputs.some(input => !goal(input, spec.run(input)));
    const working = fixes.filter(fix => spec.inputs.every(input => goal(input, fix.runFixed(input))));

    return { describe, followUp: { lines: originalFails ? working.map(fix => fix.line) : [] } };
  };
}

const SOLVERS = Object.fromEntries(Object.entries(SPECS).map(([id, spec]) => [id, solveCodeReading(id, spec)]));

SOLVERS["CR-AI-S1-01"] = q => {
  expectSource(q, lines(
    "def shout(names):",
    "    out = []",
    "    for n in names:",
    "        if len(n) <= 3:",
    "            out.append(n.upper())",
    "    return out"
  ));

  const shout = names => names.filter(n => n.length <= 3).map(n => n.toUpperCase());
  const inputs = [["Ada", "Grace", "Bo"], ["Tim", "Lin", "Ahmad"], ["Jo"], []];

  return {
    facts: [
      { mention: "3 or fewer letters", holds: inputs.every(names => shout(names).length === names.filter(n => n.length <= 3).length) },
      { mention: "capitals", holds: inputs.every(names => shout(names).every(n => n === n.toUpperCase())) && shout(["Ada"])[0] !== "Ada" },
      { mention: "left out", holds: !shout(["Ada", "Grace", "Bo"]).includes("GRACE") }
    ]
  };
};

SOLVERS["CR-AI-S2-01"] = q => {
  expectSource(q, lines(
    "func streak(_ days: [Bool]) -> Int {",
    "    var best = 0",
    "    var current = 0",
    "    for d in days {",
    "        if d {",
    "            current += 1",
    "            best = max(best, current)",
    "        } else {",
    "            current = 0",
    "        }",
    "    }",
    "    return best",
    "}"
  ));

  const streak = days => {
    let best = 0;
    let current = 0;
    days.forEach(d => {
      if (d) {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    });
    return best;
  };
  const longestRun = days => Math.max(0, ...days.map((_, i) => {
    let n = 0;
    while (days[i + n]) n += 1;
    return n;
  }));
  const inputs = [[true, true, false, true], [false, true, true, true, false, true], [true], [false, false], []];

  return {
    facts: [
      { mention: "longest run", holds: inputs.every(days => streak(days) === longestRun(days)) },
      // Not just a count of true values: the first input has three but gives 2.
      { mention: "in a row", holds: streak([true, true, false, true]) === 2 },
      { mention: "0 if there are none", holds: streak([false, false]) === 0 && streak([]) === 0 }
    ]
  };
};

module.exports = {
  SOLVERS,
  SPECS,
  withLine,
  lineFixes
};
