// What the student sees on the review page before submitting: which
// questions have an answer, which are only partly answered and which were
// skipped. Pure functions, no DOM.
//
// A question is unanswered when its response is undefined or null (the
// renderer contract in type-registry.js stores a blank answer that way).
// Under "each" and in-order navigation, an answer the server has committed
// is locked: "locked-skipped" when the commit was a skip, "locked" otherwise.
// A renderer may add isPartial(question, response) for answers that are only
// part of what is asked (code-reading with a follow-up).
//
// UMD like web/charts.js, so node can require it for tests.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CTQuestReview = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  function questionState(question, response, committed, renderer) {
    if (committed && committed.skipped) return "locked-skipped";
    if (committed) return "locked";
    if (response === undefined || response === null) return "unanswered";
    if (renderer && typeof renderer.isPartial === "function" && renderer.isPartial(question, response)) return "partial";
    return "answered";
  }

  // committed is keyed by question id; getRenderer(question) may return
  // undefined. missing counts what will score zero if the student submits
  // now: unanswered, skipped-and-locked, and questions never delivered.
  function summarize(questions, answers, committed, getRenderer, questionCount) {
    const rows = questions.map((question, index) => ({
      index,
      id: question.id,
      title: question.title,
      state: questionState(question, answers[question.id], committed[question.id], getRenderer(question))
    }));
    const count = state => rows.filter(row => row.state === state).length;
    const undelivered = Math.max(0, (questionCount || 0) - questions.length);

    return {
      rows,
      answered: count("answered") + count("locked"),
      partial: count("partial"),
      unanswered: count("unanswered"),
      lockedSkipped: count("locked-skipped"),
      missing: count("unanswered") + count("locked-skipped") + undelivered
    };
  }

  // In order, the end is reachable only once every question is held and
  // committed; with free navigation it always is.
  function reviewReachable({ linear, held, questionCount, committedCount }) {
    return !linear || (held >= questionCount && committedCount >= questionCount);
  }

  return { questionState, summarize, reviewReachable };
}));
