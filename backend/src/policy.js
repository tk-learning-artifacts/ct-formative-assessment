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

// What a student may see of an answer's scoring detail: who marked it and the
// feedback. AI feedback is shown only once validated ("scored"); a teacher's
// review replaces it. Failure reasons, criterion ids, model names and
// reviewer ids stay with the teacher.
function studentFeedback(detail) {
  if (!detail || typeof detail !== "object") {
    return null;
  }

  if (detail.review) {
    return detail.review.feedback ? { source: "teacher", feedback: detail.review.feedback } : { source: "teacher" };
  }

  if (detail.ai === "scored") {
    const view = { source: "ai", feedbackCode: detail.feedbackCode };

    if (detail.feedback) {
      view.feedback = detail.feedback;
    }

    return view;
  }

  return null;
}

// result: { score, max, pending, perQuestion } as computed from the stored
// answers. pending counts answers still being marked; the total rises as
// they are scored.
function studentResultView(event, result, now = Date.now()) {
  if (!result) {
    return null;
  }

  const released = breakdownReleased(event, now);
  const view = {
    score: result.score,
    max: result.max,
    pending: result.pending || 0,
    breakdownReleased: released
  };

  if (released) {
    view.perQuestion = result.perQuestion.map(item => ({ ...item, detail: studentFeedback(item.detail) }));
  }

  return view;
}

module.exports = {
  normalizePart,
  studentKey,
  breakdownReleased,
  studentFeedback,
  studentResultView
};
