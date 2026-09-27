// Assessment policy: who may start an attempt, and what a student may see
// about their own result. Decided by Akmal on 2026-09-27 (review item 2) to
// stop students recovering the answer key by submitting repeated attempts:
//
// - One attempt per student per event. A student is identified by their name
//   and class group after normalisation (NFKC, trimmed, internal whitespace
//   collapsed, lower-cased), so "Ada  Tan" and "ada tan" are the same person.
//   A teacher can reset an attempt so the student may start again.
// - On submit a student sees only their total. The per-question breakdown
//   (which questions were right, chosen and correct options, AI feedback) is
//   withheld until the event's end_at has passed or the teacher releases
//   results.
//
// Every route that shows a student their result goes through
// studentResultView(), so this file is the only place the rule lives.

function normalizePart(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .normalize("NFKC");
}

// The unit separator cannot be typed into a name field, so the key is
// unambiguous.
function studentKey(name, group) {
  return `${normalizePart(name)}\u001f${normalizePart(group)}`;
}

function breakdownReleased(event, now = Date.now()) {
  if (!event) {
    return false;
  }

  if (event.results_released_at) {
    return true;
  }

  return Boolean(event.end_at && now > Date.parse(event.end_at));
}

// result: { score, max, perQuestion } as computed from the stored answers.
function studentResultView(event, result, now = Date.now()) {
  if (!result) {
    return null;
  }

  const released = breakdownReleased(event, now);
  const view = {
    score: result.score,
    max: result.max,
    breakdownReleased: released
  };

  if (released) {
    view.perQuestion = result.perQuestion;
  }

  return view;
}

module.exports = {
  normalizePart,
  studentKey,
  breakdownReleased,
  studentResultView
};
