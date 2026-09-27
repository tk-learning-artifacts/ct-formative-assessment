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
// A teacher may change both settings mid-event (ADR 0003 §10). Every
// function here is given the event as it is now, so the new rule applies
// from a student's next request: loosening shows results already earned,
// tightening hides them again until the new rule allows. A committed answer
// is never reopened by any change; db.js keeps it whatever the mode.
//
// Every route that shows a student their result, or a committed answer, goes
// through studentResultView() or committedAnswerView(), so this file is the
// only place these rules live.
//
// The total before release (decided here, 2026-09-27). Under "release" the
// student sees a total but not the breakdown. If that total rose when an AI
// or teacher mark arrived, the rise would tell the student whether their
// written answer earned credit, which is the breakdown by another route.
// Until release, the total a student sees is therefore the score of the
// questions marked the moment they were answered (every type that does not
// need the AI), labelled "Marked so far", with the number of answers marked
// later. Both numbers are fixed at submit: neither depends on whether, or
// how, those answers have been marked since. Hiding the total altogether
// was the alternative; it was not chosen because an event with no AI
// questions would lose the total its students see today, and the instant
// part leaks nothing. Teachers always see the full total.

const scoring = require("./scoring");

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

// Whether an answer is marked after it is given, by the AI job or the
// teacher, rather than by its scorer at once. A blank answer to an AI-scored
// question is scored 0 on the spot and is never sent, so it is not waiting
// for anything.
function marksLater(item) {
  const impl = scoring.getType(item.type);
  return Boolean(impl && impl.requiresAi) && item.response !== null;
}

// The total a student may see. Once the breakdown is visible it is the full
// total, and pending counts answers still being marked. Before that (only
// under "release") it is the instant part, with markedSoFar set and pending
// counting every answer marked later, whatever its status now; see the note
// at the top of this file. An AI-scored question contributes nothing to the
// instant part even when its answer was blank, so a teacher's mark on it
// cannot move the total either.
function studentTotal(event, result, now = Date.now()) {
  const released = studentMaySeeBreakdown(event, now);
  const items = result.perQuestion || [];

  if (released) {
    return { score: result.score, max: result.max, pending: result.pending || 0, markedSoFar: false, breakdownReleased: true };
  }

  const later = items.filter(marksLater).length;
  const instant = items
    .filter(item => {
      const impl = scoring.getType(item.type);
      return !(impl && impl.requiresAi);
    })
    .reduce((sum, item) => sum + (item.earned || 0), 0);

  return { score: instant, max: result.max, pending: later, markedSoFar: later > 0, breakdownReleased: false };
}

// result: { score, max, pending, perQuestion } as computed from the stored
// answers. pending counts answers still being marked. The total is the one
// studentTotal allows: it rises as answers are marked only once the
// breakdown is visible.
function studentResultView(event, result, now = Date.now()) {
  if (!result) {
    return null;
  }

  const view = studentTotal(event, result, now);
  const released = view.breakdownReleased;

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
  marksLater,
  studentTotal,
  studentResultView
};
