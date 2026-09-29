// Solvers for backend/content/questions/type-samples.json.
//
// A code-trace solver returns the program's output, computed by a JavaScript
// translation of the pinned source. A Parsons solver gets the program built
// from one accepted order of lines and returns its output; it pins every
// source it knows, so a new alternative order or an edited line needs a
// deliberate update here. answer-keys.test.js also runs the real programs
// under python3 and swift when those are installed.
//
// Questions with a figure (ADR 0007) read the data they need from it: the
// grid a robot walks, the boxes a procedure reads, the network or table it
// works through. The robot Parsons questions (scratch-style, which no real
// interpreter runs) also try every order of every subset of their lines, so
// an order the key does not list that still prints the target fails the
// test instead of marking a child wrong.

const { must, agree, cellValues, graphEdges, pythonRange, swiftStrideTo } = require("./lib");

function expectSource(q, source, expected) {
  if (!expected.includes(source)) {
    throw new Error(`${q.id}: code changed; update the solver's JavaScript translation to match`);
  }
}

function lines(...parts) {
  return parts.join("\n");
}

// The question's figure, which these solvers cannot work without.
function figure(q, kind) {
  must(q.visual && q.visual.kind === kind, `a ${kind} visual`);
  return q.visual;
}

// A grid figure's rows as an array of strings; x is the column (A = 0) and
// y the row (1 = 0), as the grid kind letters and numbers them.
function gridRows(q) {
  const rows = must(figure(q, "grid").rows, "the grid's rows");
  return { rows, at: (x, y) => (y < 0 || y >= rows.length || x < 0 || x >= rows[0].length ? "#" : rows[y][x]) };
}

function find(rows, letter) {
  const y = rows.findIndex(row => row.includes(letter));
  return must(y >= 0 && { x: rows[y].indexOf(letter), y }, `${letter} in the grid`);
}

function squareName({ x, y }) {
  return `${String.fromCharCode(65 + x)}${y + 1}`;
}

const DIRS = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };

// The robot language of the scratch-style grid questions: "move <dir> <n>",
// "say where you are" and "repeat <n> times" with its body indented by four
// spaces. bump is what a move into a wall does: "stop" ends that move early
// and carries on (TS-CT-05), "fail" ends the program with no output
// (the Parsons questions). Returns the lines said, or null for a program
// that fails or does not parse.
function runRobot(grid, source, { bump }) {
  const program = source.split("\n");
  let pos = find(grid.rows, "S");
  const said = [];

  function step(text) {
    const moveMatch = text.match(/^move (right|left|up|down) (\d+)$/);
    if (moveMatch) {
      const [dx, dy] = DIRS[moveMatch[1]];
      for (let i = 0; i < Number(moveMatch[2]); i += 1) {
        if (grid.at(pos.x + dx, pos.y + dy) === "#") {
          if (bump === "stop") return true;
          return false;
        }
        pos = { x: pos.x + dx, y: pos.y + dy };
      }
      return true;
    }
    if (text === "say where you are") {
      said.push(squareName(pos));
      return true;
    }
    return false;
  }

  for (let i = 0; i < program.length; i += 1) {
    const line = program[i];
    const repeat = line.match(/^repeat (\d+) times$/);

    if (repeat) {
      const body = [];
      while (i + 1 < program.length && program[i + 1].startsWith("    ")) {
        body.push(program[i + 1].slice(4));
        i += 1;
      }
      if (!body.length) return null;
      for (let n = 0; n < Number(repeat[1]); n += 1) {
        if (!body.every(step)) return null;
      }
    } else if (line.startsWith(" ") || !step(line)) {
      return null;
    }
  }

  return said;
}

// Every order of every non-empty subset of the question's lines that prints
// the target must be an accepted order, compared by text as the scorer does.
function onlyAcceptedOrdersPrint(q, printed) {
  const text = new Map(q.lines.map(line => [line.id, line.text]));
  const accepted = new Set([q.answer.order].concat(q.answer.alternatives || []).map(order => order.map(id => text.get(id)).join("\n")));
  const all = q.lines.map(line => line.text);
  const extra = [];

  (function extend(chosen, left) {
    if (chosen.length) {
      const source = chosen.join("\n");
      if (printed(source) === q.expectedOutput && !accepted.has(source)) {
        extra.push(source);
      }
    }
    left.forEach((line, i) => extend(chosen.concat(line), left.slice(0, i).concat(left.slice(i + 1))));
  })([], all);

  if (extra.length) {
    throw new Error(`${q.id}: ${extra.length} order(s) the key does not accept also print ${JSON.stringify(q.expectedOutput)}, e.g. ${JSON.stringify(extra[0])}`);
  }
}

// A robot Parsons solver: checks the other orders once per question, then
// runs the order it is given.
const robotChecked = new Set();

function robotParsons(q, source) {
  const grid = gridRows(q);
  const printed = src => {
    const said = runRobot(grid, src, { bump: "fail" });
    return said === null ? null : said.join("\n");
  };
  must(/from S to T/.test(q.prompt), "S and T in the prompt");
  agree(q.expectedOutput === squareName(find(grid.rows, "T")), "the square T is on");

  const key = JSON.stringify([q.id, q.lines, q.answer, q.visual.rows]);
  if (!robotChecked.has(key)) {
    onlyAcceptedOrdersPrint(q, printed);
    robotChecked.add(key);
  }

  return printed(must(source, "the program to run"));
}

// Walks a graph figure: its undirected edges as a map from each node to
// [neighbour, weight] pairs.
function graphLinks(q) {
  const visual = figure(q, "graph");
  must(Array.isArray(visual.edges) && Array.isArray(visual.nodes), "the graph's nodes and edges");
  const links = new Map(visual.nodes.map(node => [node.id, []]));
  visual.edges.forEach(edge => {
    links.get(edge.from).push([edge.to, edge.weight]);
    links.get(edge.to).push([edge.from, edge.weight]);
  });
  return links;
}

function tableRows(q, columns) {
  const visual = figure(q, "table");
  agree(JSON.stringify(visual.columns) === JSON.stringify(columns), "the table's columns");
  return must(visual.rows, "the table's rows");
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
  },
  // ---------- Questions with figures, and more of each type ----------

  "TS-CT-04": q => {
    expectSource(q, q.code.source, [lines(
      "when green flag clicked",
      "go to pad 1",
      "repeat 3 times",
      "    hop forward 2 pads",
      "    say the letter on this pad",
      "end"
    )]);
    const pads = cellValues(must(figure(q, "cells").rows, "the lily pads")[0]);
    agree(q.visual.numbered === true && !q.visual.numberFrom, "pads numbered from 1");
    must(/lily pad 1\b/.test(q.prompt), "the starting pad in the prompt");

    const out = [];
    let pad = 1;
    for (let i = 0; i < 3; i += 1) {
      pad += 2;
      out.push(must(pads[pad - 1], `pad ${pad}`));
    }
    return out.join("\n");
  },

  // Moves stop early at a wall and the robot carries on with the next line.
  "TS-CT-05": q => {
    must(/stops that move early and goes on to the next line/.test(q.prompt), "the wall rule");
    const said = runRobot(gridRows(q), `${q.code.source}\nsay where you are`, { bump: "stop" });
    return must(said, "a program the robot can run")[0];
  },

  "TS-CT-06": q => {
    expectSource(q, q.code.source, [lines(
      "set total to 0",
      "for each bulb, left to right",
      "    if the bulb is ON then",
      "        add its value to total",
      "    end",
      "end",
      "say total"
    )]);
    const [values, bulbs] = must(figure(q, "cells").rows, "the panel's rows");
    const worth = cellValues(values).map(Number);
    const states = cellValues(bulbs);
    agree(values.label === "Value" && bulbs.label === "Bulb", "which row is which");
    agree(states.every(state => state === "ON" || state === "OFF"), "every bulb ON or OFF");
    // An OFF bulb is drawn dark and an ON one light, so the figure never
    // relies on the word alone.
    agree(bulbs.cells.every(cell => (cell === "ON") === (typeof cell === "string")), "OFF bulbs drawn dark");

    let total = 0;
    states.forEach((state, i) => {
      if (state === "ON") total += worth[i];
    });
    return String(total);
  },

  // Runs the flowchart itself and checks it against the script.
  "TS-CT-07": q => {
    expectSource(q, q.code.source, [lines(
      "set coins to 1",
      "set days to 0",
      "repeat until coins is over 20",
      "    double coins",
      "    change days by 1",
      "end",
      "say days"
    )]);
    const visual = figure(q, "flowchart");
    const byId = new Map(must(visual.nodes, "the flowchart's boxes").map(node => [node.id, node]));
    const next = (from, label) => must(visual.edges.find(edge => edge.from === from && edge.label === label), `the arrow out of ${from}`).to;
    const check = must(visual.nodes.find(node => node.type === "decision"), "the question box");
    const limit = Number(must(check.text.match(/More than (\d+) coins/), "the limit in the question box")[1]);
    const set = must(visual.nodes.find(node => /^Set coins to (\d+) and days to (\d+)$/.test(node.text)), "the starting values");
    const [, coins0, days0] = set.text.match(/^Set coins to (\d+) and days to (\d+)$/);
    agree(byId.get(next(check.id, "No")).text === "Double coins and add 1 to days", "the loop body");
    agree(byId.get(next(check.id, "Yes")).text === "Say days", "what it says");
    agree(visual.edges.some(edge => edge.from === next(check.id, "No") && edge.to === check.id), "the loop back");

    let coins = Number(coins0);
    let days = Number(days0);
    while (!(coins > limit)) {
      coins *= 2;
      days += 1;
    }
    return String(days);
  },

  "TS-PA-04": robotParsons,

  // Greedy: always the cheapest road to somewhere new.
  "TS-CT-08": q => {
    expectSource(q, q.code.source, [lines(
      "start at A",
      "set total to 0",
      "repeat until you are at F",
      "    of the roads to new places,",
      "        take the shortest one",
      "    add its number to total",
      "end",
      "say total"
    )]);
    const links = graphLinks(q);
    const visited = new Set(["A"]);
    let at = "A";
    let total = 0;

    while (at !== "F") {
      const options = links.get(at).filter(([to]) => !visited.has(to)).sort((a, b) => a[1] - b[1]);
      must(options.length, `a road out of ${at} to somewhere new`);
      must(options.length === 1 || options[0][1] !== options[1][1], `a single smallest road out of ${at}`);
      [at] = options[0];
      total += options[0][1];
      visited.add(at);
    }
    return String(total);
  },

  "TS-CT-09": q => {
    const inside = cellValues(must(figure(q, "cells").rows, "the lockers")[0]).map(Number);
    const target = Number(must(q.prompt.match(/holds the number (\d+)/), "the number looked for")[1]);
    agree((q.code.source.match(new RegExp(`repeat until it finds ${target}\n`, "g")) || []).length === 2, "the number both robots look for");
    must(/\(left to right\)[\s\S]*\(right to left\)/.test(q.code.source), "A from the left and B from the right");
    agree(inside.filter(n => n === target).length === 1, `one locker holding ${target}`);
    const fromLeft = inside.indexOf(target) + 1;
    const fromRight = inside.length - inside.indexOf(target);
    return `${fromLeft}\n${fromRight}`;
  },

  "TS-CT-10": q => {
    expectSource(q, q.code.source, [lines(
      "for each parcel, top to bottom",
      "    if heavier than 5 kg then",
      "        say Truck",
      "    else if it is fragile then",
      "        say Van",
      "    else",
      "        say Bike",
      "    end",
      "end"
    )]);
    return tableRows(q, ["Parcel", "Weight (kg)", "Fragile?"]).map(([, weight, fragile]) => {
      agree(fragile === "Yes" || fragile === "No", "Yes or No for fragile");
      if (Number(weight) > 5) return "Truck";
      if (fragile === "Yes") return "Van";
      return "Bike";
    }).join("\n");
  },

  "TS-PA-05": robotParsons,

  // The carry, done digit by digit on the bulbs in the figure; the result is
  // checked against ordinary addition.
  "TS-CT-11": q => {
    expectSource(q, q.code.source, [lines(
      "repeat 3 times",
      "    go to the rightmost bulb",
      "    while this bulb is 1",
      "        set it to 0",
      "        move one bulb left",
      "    end",
      "    set this bulb to 1",
      "    say the four bulbs",
      "end"
    )]);
    const [values, start] = must(figure(q, "cells").rows, "the bulbs");
    agree(cellValues(values).join(",") === "8,4,2,1", "the place values");
    const bulbs = cellValues(start).map(Number);
    const worth = pattern => pattern.reduce((sum, bit, i) => sum + bit * [8, 4, 2, 1][i], 0);
    const out = [];

    for (let n = 0; n < 3; n += 1) {
      const before = worth(bulbs);
      let i = bulbs.length - 1;
      while (bulbs[i] === 1) {
        bulbs[i] = 0;
        i -= 1;
      }
      must(i >= 0, "room for the carry");
      bulbs[i] = 1;
      agree(worth(bulbs) === before + 1, "adding 1");
      out.push(bulbs.join(""));
    }
    return out.join("\n");
  },

  // The prices come from the table, and the function built from the lines
  // must charge them.
  "TS-PA-06": (q, source) => {
    const body = ["def price(age):", "    if age < 4:", "        return 0", "    if age < 13:", "        return 5", "    return 10"];
    expectSource(q, source, [lines(...body, "for a in [3, 4, 12, 13]:", "    print(price(a))")]);
    const table = tableRows(q, ["Age", "Ticket price"]);
    agree(JSON.stringify(table) === JSON.stringify([["Under 4", "Free (0)"], ["4 to 12", "5"], ["13 and over", "10"]]), "the prices");

    const price = age => {
      if (age < 4) return 0;
      if (age < 13) return 5;
      return 10;
    };
    const fromTable = age => (age < 4 ? 0 : age <= 12 ? 5 : 10);
    [0, 3, 4, 12, 13, 30].forEach(age => agree(price(age) === fromTable(age), `the price for age ${age}`));
    return [3, 4, 12, 13].map(price).join("\n");
  },

  // Adds the number above and the number to the left, row by row, and
  // checks that against listing every right-or-down route.
  "TS-CT-12": q => {
    must(/only move right or down/.test(q.prompt), "the moves allowed");
    must(/else write above \+ left/.test(q.code.source) && /"above \+ left" means the number on the square above plus the number on the square to its left/.test(q.prompt), "the counting rule");
    const grid = gridRows(q);
    const { rows } = grid;
    const count = rows.map(row => Array.from(row, () => 0));

    rows.forEach((row, y) => Array.from(row).forEach((cell, x) => {
      if (cell === "S") count[y][x] = 1;
      else if (cell === "#") count[y][x] = 0;
      else count[y][x] = (y > 0 ? count[y - 1][x] : 0) + (x > 0 ? count[y][x - 1] : 0);
    }));

    const start = find(rows, "S");
    const target = find(rows, "T");
    const routes = (x, y) => {
      if (grid.at(x, y) === "#") return 0;
      if (x === target.x && y === target.y) return 1;
      return (x < target.x ? routes(x + 1, y) : 0) + (y < target.y ? routes(x, y + 1) : 0);
    };
    const listed = routes(start.x, start.y);
    agree(listed === count[target.y][target.x], "the procedure and the routes listed one by one");
    return String(listed);
  },

  "TS-CT-13": q => {
    const boxes = cellValues(must(figure(q, "cells").rows, "the boxes")[0]).map(Number);
    const target = Number(must(q.prompt.match(/looks for the number (\d+)/), "the number looked for")[1]);
    agree(boxes.every((n, i) => i === 0 || boxes[i - 1] < n), "the boxes in order");
    must(q.code.source.includes(`set high to ${boxes.length}`), "high set to the number of boxes");
    must(q.code.source.includes(`if it is ${target} then stop`) && q.code.source.includes(`less than ${target} then`), "the target in the procedure");
    must(q.code.source.includes("mid = (low + high) ÷ 2\n    round mid down"), "the middle rounded down");

    const out = [];
    let low = 1;
    let high = boxes.length;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      out.push(String(boxes[mid - 1]));
      if (boxes[mid - 1] === target) break;
      if (boxes[mid - 1] < target) low = mid + 1;
      else high = mid - 1;
    }
    return out.join("\n");
  },

  "TS-CT-14": q => {
    expectSource(q, q.code.source, [lines(
      "set word to nothing",
      "for each box, from box 1",
"    take the letter in the box",
"    count back in the alphabet",
"        by the box number",
"        (before A comes Z)",
      "    add it to the end of word",
      "end",
      "say word"
    )]);
    const code = cellValues(must(figure(q, "cells").rows, "the coded letters")[0]);
    agree(q.visual.numbered === true && !q.visual.numberFrom, "boxes numbered from 1");
    const word = code.map((letter, i) => String.fromCharCode(((letter.charCodeAt(0) - 65 - (i + 1)) % 26 + 26) % 26 + 65)).join("");
    // Coding the word again, as the prompt describes, gives the code back.
    agree(Array.from(word, (letter, i) => String.fromCharCode((letter.charCodeAt(0) - 65 + i + 1) % 26 + 65)).join("") === code.join(""), "the coding rule");
    return word;
  },

  "TS-CT-15": q => {
    expectSource(q, q.code.source, [lines(
      "score = 0",
      "lives = 3",
      "",
      "def on_tap():",
      "    global score",
      "    score += 1",
      "",
      "def on_swipe():",
      "    global score",
      "    score = score * 2",
      "",
      "def on_hold():",
      "    global lives",
      "    lives -= 1",
      "",
      "handlers = {",
"    \"tap\": on_tap,",
"    \"swipe\": on_swipe,",
"    \"hold\": on_hold",
"}",
"",
"events = [\"tap\", \"tap\", \"swipe\",",
"          \"hold\", \"tap\", \"swipe\"]",
"for event in events:",
      "    handlers[event]()",
      "",
      "print(score, lives)"
    )]);
    const events = ["tap", "tap", "swipe", "hold", "tap", "swipe"];

    let score = 0;
    let lives = 3;
    const handlers = { tap: () => { score += 1; }, swipe: () => { score *= 2; }, hold: () => { lives -= 1; } };
    events.forEach(event => handlers[event]());
    return `${score} ${lives}`;
  },

  "TS-CT-16": q => {
    expectSource(q, q.code.source, [lines(
      "def run(order):",
      "    x = 1",
      "    for who in order:",
      "        if who == \"A\":",
      "            x = x * 2",
      "        else:",
      "            x = x + 3",
      "    return x",
      "",
      "print(run(\"AAB\"))",
      "print(run(\"ABA\"))",
      "print(run(\"BAA\"))"
    )]);
    const step = { A: "A: x × 2", B: "B: x + 3" };
    const table = tableRows(q, ["Order", "1st turn", "2nd turn", "3rd turn"]);
    const orders = ["AAB", "ABA", "BAA"];
    agree(table.map(row => row[0]).join(",") === orders.join(","), "the orders");
    table.forEach(([order, ...turns]) => agree(turns.join("|") === Array.from(order, who => step[who]).join("|"), `the turns for ${order}`));

    const run = order => Array.from(order).reduce((x, who) => (who === "A" ? x * 2 : x + 3), 1);
    return orders.map(order => String(run(order))).join("\n");
  },

  "TS-CT-17": q => {
    expectSource(q, q.code.source, [lines(
      "def count_words(text):",
      "    count = 0",
      "    for ch in text:",
      "        if ch == \" \":",
      "            count += 1",
      "    return count + 1",
      "",
      "print(count_words(\"I like cats\"))",
      "print(count_words(\"hello\"))",
      "print(count_words(\"\"))",
      "print(count_words(\"two  spaces\"))"
    )]);
    const countWords = text => Array.from(text).filter(ch => ch === " ").length + 1;
    return ["I like cats", "hello", "", "two  spaces"].map(text => String(countWords(text))).join("\n");
  },

  // The Python must print what the Swift in `code` prints.
  "TS-PA-07": (q, source) => {
    expectSource(q, q.code.source, [lines(
      "let words = [\"cat\", \"ox\", \"emu\"]",
      "for w in words where w.count > 2 {",
      "    print(w.uppercased())",
      "}"
    )]);
    expectSource(q, source, [lines(
      "words = [\"cat\", \"ox\", \"emu\"]",
      "for w in words:",
      "    if len(w) > 2:",
      "        print(w.upper())"
    )]);
    return ["cat", "ox", "emu"].filter(w => w.length > 2).map(w => w.toUpperCase()).join("\n");
  },

  // The two functions can be defined in either order.
  "TS-PA-08": (q, source) => {
    const cost = ["def cost(n, price):", "    return n * price"];
    const dozen = ["def dozen(price):", "    return cost(12, price)"];
    const calls = ["print(dozen(3))", "print(cost(4, 5))"];
    expectSource(q, source, [lines(...cost, ...dozen, ...calls), lines(...dozen, ...cost, ...calls)]);

    const costOf = (n, price) => n * price;
    const dozenOf = price => costOf(12, price);
    return `${dozenOf(3)}\n${costOf(4, 5)}`;
  },

  "TS-CT-18": q => {
    expectSource(q, q.code.source, [lines(
      "nums = [7, 3, 9, 2, 5]",
      "for i in range(len(nums) - 1):",
      "    small = i",
      "    for j in range(i + 1, len(nums)):",
      "        if nums[j] < nums[small]:",
      "            small = j",
      "    nums[i], nums[small] = nums[small], nums[i]",
      "    print(nums)"
    )]);
    const nums = [7, 3, 9, 2, 5];
    agree(figure(q, "cells").numberFrom === 0, "indexes starting at 0");
    agree(cellValues(must(q.visual.rows, "the list")[0]).map(Number).join(",") === nums.join(","), "the list");

    const out = [];
    pythonRange(0, nums.length - 1, 1).forEach(i => {
      let small = i;
      pythonRange(i + 1, nums.length, 1).forEach(j => {
        if (nums[j] < nums[small]) small = j;
      });
      [nums[i], nums[small]] = [nums[small], nums[i]];
      out.push(`[${nums.join(", ")}]`);
    });
    return out.join("\n");
  },

  // The dictionary is parsed from the code and must draw the same network
  // as the figure.
  "TS-CT-19": q => {
    const block = must(q.code.source.match(/^links = \{\n([\s\S]*?)\n\}/), "the links dictionary")[1];
    const links = {};
    block.split("\n").forEach(line => {
      const [, node, list] = must(line.match(/^ {4}"(\w)": \[(.*)\],?$/), `a dictionary line (${line})`);
      links[node] = (list.match(/"(\w)"/g) || []).map(item => item.slice(1, -1));
    });
    must(q.code.source.includes("seen = [\"A\"]\nqueue = [\"A\"]\nwhile queue:\n    node = queue.pop(0)\n    print(node)"), "the queue loop");

    const fromCode = [];
    Object.entries(links).forEach(([node, list]) => list.forEach(other => {
      agree(links[other] && links[other].includes(node), `the link ${node}-${other} going both ways`);
      if (node < other) fromCode.push(`${node}-${other}`);
    }));
    agree(fromCode.sort().join(",") === graphEdges(figure(q, "graph")).join(","), "the links");

    const seen = ["A"];
    const queue = ["A"];
    const out = [];
    while (queue.length) {
      const node = queue.shift();
      out.push(node);
      links[node].forEach(next => {
        if (!seen.includes(next)) {
          seen.push(next);
          queue.push(next);
        }
      });
    }
    return out.join("\n");
  },

  "TS-CT-20": q => {
    expectSource(q, q.code.source, [lines(
      "queue = [\"open\"]",
      "log = []",
      "",
      "def on_open():",
      "    log.append(\"open\")",
      "    queue.append(\"load\")",
      "    queue.append(\"draw\")",
      "",
      "def on_load():",
      "    log.append(\"load\")",
      "    queue.append(\"save\")",
      "",
      "def on_draw():",
      "    log.append(\"draw\")",
      "",
      "def on_save():",
      "    log.append(\"save\")",
      "",
      "handlers = {",
"    \"open\": on_open,",
"    \"load\": on_load,",
"    \"draw\": on_draw,",
"    \"save\": on_save",
"}",
      "",
      "while queue:",
      "    event = queue.pop(0)",
      "    handlers[event]()",
      "",
      "print(log)"
    )]);
    const queue = ["open"];
    const log = [];
    const handlers = {
      open: () => { log.push("open"); queue.push("load", "draw"); },
      load: () => { log.push("load"); queue.push("save"); },
      draw: () => { log.push("draw"); },
      save: () => { log.push("save"); }
    };
    while (queue.length) handlers[queue.shift()]();
    return `[${log.map(item => `'${item}'`).join(", ")}]`;
  },

  // Traces the AI's code, not the spec; the spec table must disagree with
  // it somewhere, or the question has nothing to find.
  "TS-CT-21": q => {
    expectSource(q, q.code.source, [lines(
      "def grade(score):",
      "    if score > 80:",
      "        return \"A\"",
      "    elif score > 65:",
      "        return \"B\"",
      "    elif score >= 50:",
      "        return \"C\"",
      "    return \"F\"",
      "",
      "for s in [80, 65, 64, 50, 49]:",
      "    print(s, grade(s))"
    )]);
    const bands = tableRows(q, ["Score", "Grade in the spec"]).map(([range, letter]) => {
      const [, low, high] = must(range.match(/^(\d+) to (\d+)$/), "a score band");
      return { low: Number(low), high: Number(high), letter };
    });
    const spec = score => must(bands.find(band => score >= band.low && score <= band.high), `a band for ${score}`).letter;
    const grade = score => (score > 80 ? "A" : score > 65 ? "B" : score >= 50 ? "C" : "F");
    const scores = [80, 65, 64, 50, 49];
    agree(scores.some(score => spec(score) !== grade(score)), "a score where the code breaks the spec");
    return scores.map(score => `${score} ${grade(score)}`).join("\n");
  },

  "TS-PA-09": (q, source) => {
    expectSource(q, source, [lines(
      "def place(nums, x):",
      "    i = 0",
      "    while i < len(nums) and nums[i] < x:",
      "        i += 1",
      "    nums.insert(i, x)",
      "    return nums",
      "print(place([2, 5, 8], 6))",
      "print(place([1, 3], 9))"
    )]);
    const place = (nums, x) => {
      let i = 0;
      while (i < nums.length && nums[i] < x) i += 1;
      nums.splice(i, 0, x);
      return nums;
    };
    return [place([2, 5, 8], 6), place([1, 3], 9)].map(list => `[${list.join(", ")}]`).join("\n");
  }
};
