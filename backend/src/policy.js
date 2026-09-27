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
// Per-event settings (decided by Akmal on 2026-09-27, ADR 0003) choose when a
// student sees their per-question results, and how they move through the
// test. The one-attempt rule holds in every combination.
//
// feedback_mode
//   "release"  the default above: breakdown after end_at or a teacher release.
//   "end"      the breakdown shows as soon as the student submits.
//   "each"     each answer is committed on its own; the student sees that
//              question's result straight away, and the answer is locked.
// navigation_mode
//   "free"     back, next, skip and come back (the default).
//   "linear"   forward only. Every question is committed as it is left,
//              answered or explicitly skipped (a blank answer, zero points),
//              and a committed question cannot be revisited or changed.
//
// Answers are committed one at a time only when a setting needs it
// (locksAnswers); otherwise everything arrives at submit, as before.
//
// Every route that shows a student their result, or a committed answer, goes
// through studentResultView() or committedAnswerView(), so this file is the
// only place these rules live.

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

const FEEDBACK_MODES = ["each", "end", "release"];
const NAVIGATION_MODES = ["free", "linear"];
const DEFAULT_FEEDBACK_MODE = "release";
const DEFAULT_NAVIGATION_MODE = "free";

function feedbackMode(event) {
  return event && FEEDBACK_MODES.includes(event.feedback_mode) ? event.feedback_mode : DEFAULT_FEEDBACK_MODE;
}

function navigationMode(event) {
  return event && NAVIGATION_MODES.includes(event.navigation_mode) ? event.navigation_mode : DEFAULT_NAVIGATION_MODE;
}

// Whether answers are committed (and locked) one question at a time.
function locksAnswers(event) {
  return feedbackMode(event) === "each" || navigationMode(event) === "linear";
}

// Whether the teacher has released results, or end_at has passed. This is
// the whole rule under "release", and what the teacher's page reports.
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
// reviewer ids stay with the teacher. Partial-credit counts from the
// code-trace and Parsons scorers ({ partial }) pass through unchanged.
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

  if (detail.partial && typeof detail.partial === "object") {
    return { partial: detail.partial };
  }

  return null;
}

// Whether a student with a submitted attempt may see its breakdown. Under
// "each" and "end" that is straight after submit; under "release", once
// released. Only submitted attempts have a result, so "straight after submit"
// needs no attempt check here.
function studentMaySeeBreakdown(event, now = Date.now()) {
  return feedbackMode(event) !== "release" || breakdownReleased(event, now);
}

function studentItem(item) {
  return { ...item, detail: studentFeedback(item.detail) };
}

// One committed answer, as the student may see it before submitting. item
// has the perQuestion shape. The result (correctness, the key, feedback) is
// included only under "each"; otherwise the student learns only that the
// answer is recorded, and whether it was left blank.
function committedAnswerView(event, item) {
  const view = { questionId: item.id, skipped: item.response === null };

  if (feedbackMode(event) === "each") {
    view.result = studentItem(item);
  }

  return view;
}

// The attempt's settings and committed answers, for the start and resume
// responses of an attempt still in progress.
function studentProgressView(event, committedItems) {
  return {
    feedbackMode: feedbackMode(event),
    navigationMode: navigationMode(event),
    committed: (committedItems || []).map(item => committedAnswerView(event, item))
  };
}

// result: { score, max, pending, perQuestion } as computed from the stored
// answers. pending counts answers still being marked; the total rises as
// they are scored.
function studentResultView(event, result, now = Date.now()) {
  if (!result) {
    return null;
  }

  const released = studentMaySeeBreakdown(event, now);
  const view = {
    score: result.score,
    max: result.max,
    pending: result.pending || 0,
    breakdownReleased: released
  };

  if (released) {
    view.perQuestion = result.perQuestion.map(studentItem);
  }

  return view;
}

module.exports = {
  FEEDBACK_MODES,
  NAVIGATION_MODES,
  DEFAULT_FEEDBACK_MODE,
  DEFAULT_NAVIGATION_MODE,
  normalizePart,
  studentKey,
  feedbackMode,
  navigationMode,
  locksAnswers,
  breakdownReleased,
  studentMaySeeBreakdown,
  studentFeedback,
  committedAnswerView,
  studentProgressView,
  studentResultView
};
