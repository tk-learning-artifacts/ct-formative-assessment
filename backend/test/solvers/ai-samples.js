// Checks for backend/content/questions/ai-samples.json.
//
// An open-response-ai question has no single answer to compute, so its
// solver checks the rubric instead: it re-runs the question's code in
// JavaScript and returns the facts the full-credit criterion relies on, as
// { facts: [{ mention, holds }] }. The answer-key test asserts every fact
// holds and that the full-credit criterion's description mentions it. A
// rubric that rewards a wrong explanation, or code edited without updating
// the rubric, then fails.
//
// As in rgsynapse.js, each solver pins the exact source it re-implements.

function expectSource(q, expected) {
  if (q.code.source !== expected) {
    throw new Error(`${q.id}: code changed; update the solver's JavaScript translation to match`);
  }
}

module.exports = {
  "AIS-S1-01": q => {
    expectSource(q, [
      "count = 10",
      "while count > 0:",
      "    print(count)",
      "count -= 1"
    ].join("\n"));

    // As written: the decrement is outside the loop body. Run far longer
    // than a countdown needs and check nothing changes.
    let count = 10;
    const printed = [];
    for (let step = 0; step < 1000 && count > 0; step += 1) {
      printed.push(count);
    }
    const neverEnds = count > 0 && printed.length === 1000 && printed.every(value => value === 10);

    // Fixed: the decrement indented into the loop body.
    let fixedCount = 10;
    const fixedPrinted = [];
    while (fixedCount > 0) {
      fixedPrinted.push(fixedCount);
      fixedCount -= 1;
    }

    return {
      facts: [
        { mention: "count stays 10", holds: neverEnds },
        { mention: "indent count -= 1", holds: fixedPrinted.join(",") === "10,9,8,7,6,5,4,3,2,1" }
      ]
    };
  },

  "AIS-S2-01": q => {
    expectSource(q, [
      "def average(scores):",
      "    total = 0",
      "    for s in scores:",
      "        total += s",
      "    return total / len(scores)"
    ].join("\n"));

    // Python's / raises ZeroDivisionError on a zero divisor; JavaScript
    // would quietly give NaN, so that case is made explicit.
    const average = scores => {
      let total = 0;
      scores.forEach(s => { total += s; });
      if (scores.length === 0) {
        throw new Error("ZeroDivisionError");
      }
      return total / scores.length;
    };

    let emptyCrashes = false;
    try {
      average([]);
    } catch (error) {
      emptyCrashes = error.message === "ZeroDivisionError";
    }

    return {
      facts: [
        { mention: "empty list", holds: emptyCrashes },
        { mention: "divides by zero", holds: emptyCrashes },
        // Every non-empty list works, so the empty list is the input to name.
        { mention: "input that breaks it", holds: [[1], [70, 80, 90], [0, 0], [-5, 5]].every(list => Number.isFinite(average(list))) }
      ]
    };
  },

  "AIS-S2-02": q => {
    expectSource(q, [
      "def is_palindrome(word):",
      "    return word == word[::-1]"
    ].join("\n"));

    const isPalindrome = word => word === Array.from(word).reverse().join("");
    const trulyPalindrome = word => {
      const letters = word.toLowerCase().replace(/[^a-z]/g, "");
      return letters === Array.from(letters).reverse().join("");
    };

    return {
      facts: [
        // "Racecar" is a palindrome, but the function says it is not.
        { mention: "\"Racecar\" should be True but returns False", holds: trulyPalindrome("Racecar") && !isPalindrome("Racecar") },
        { mention: "mixed case", holds: isPalindrome("racecar") && !isPalindrome("Racecar") }
      ]
    };
  }
};
