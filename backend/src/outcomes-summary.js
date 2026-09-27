// Per-outcome and per-ontology-node results summary for one event, built
// from its question snapshot and its submitted attempts. Read-only: no new
// tables, no new columns.
//
// A node's coverage rolls up its descendants, the same way an event filter
// on a node matches everything beneath it (selection.js). That means the
// three top-level nodes (concept/practice/perspective) summarise every
// question tagged anywhere beneath them, and a specific sub-node (say
// "concept.loops") is also reported on its own when a question is tagged
// with it directly.
//
// Reset attempts are dropped entirely. Attempts that have not been submitted
// yet contribute nothing. Late attempts count towards the stats like any
// other submitted attempt, but are tallied separately so the caller can flag
// them.

function roundPercent(value) {
  return Math.round(value * 10) / 10;
}

// matchedQuestions: the event's snapshot questions tagged with this outcome
// or ontology node. submittedAttempts: every non-reset, submitted attempt
// for the event, each with its per-question answers (from store.getResults).
function statsForQuestions(matchedQuestions, submittedAttempts) {
  const maxTotal = matchedQuestions.reduce((sum, question) => sum + (question.points || 0), 0);

  if (!matchedQuestions.length || maxTotal <= 0) {
    return null;
  }

  const questionIds = new Set(matchedQuestions.map(question => question.id));
  let percentSum = 0;
  let belowHalfCount = 0;
  let lateAttempts = 0;

  submittedAttempts.forEach(attempt => {
    const earned = attempt.answers
      .filter(answer => questionIds.has(answer.questionId))
      .reduce((sum, answer) => sum + (answer.earnedPoints || 0), 0);
    const percent = (earned / maxTotal) * 100;

    percentSum += percent;

    if (percent < 50) {
      belowHalfCount += 1;
    }

    if (attempt.late) {
      lateAttempts += 1;
    }
  });

  return {
    questionsCovered: matchedQuestions.length,
    submittedAttempts: submittedAttempts.length,
    lateAttempts,
    meanPercentage: submittedAttempts.length ? roundPercent(percentSum / submittedAttempts.length) : null,
    belowHalfCount
  };
}

function descendantsOf(nodeId, childrenOf) {
  const covered = new Set([nodeId]);
  const stack = [nodeId];

  while (stack.length) {
    const current = stack.pop();

    (childrenOf.get(current) || []).forEach(child => {
      if (!covered.has(child)) {
        covered.add(child);
        stack.push(child);
      }
    });
  }

  return covered;
}

// store: the app's data store (db.js createStore()); eventId: the event to
// summarise. The caller has already checked the teacher owns this event.
function buildOutcomesSummary(store, eventId) {
  const questions = store.getEventQuestions(eventId);
  const submittedAttempts = store.getResults(eventId)
    .filter(attempt => attempt.status === "submitted" && !attempt.reset_at);

  const outcomes = store.content.outcomes
    .map(outcome => {
      const matched = questions.filter(question => (question.outcomes || []).includes(outcome.id));
      const stats = statsForQuestions(matched, submittedAttempts);
      return stats && { id: outcome.id, statement: outcome.statement, ...stats };
    })
    .filter(Boolean);

  const nodes = store.listOntology();
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const childrenOf = new Map();

  nodes.forEach(node => {
    if (!node.parent) {
      return;
    }

    if (!childrenOf.has(node.parent)) {
      childrenOf.set(node.parent, []);
    }

    childrenOf.get(node.parent).push(node.id);
  });

  const directTagIds = new Set();
  questions.forEach(question => (question.ontology || []).forEach(nodeId => directTagIds.add(nodeId)));
  const topLevelIds = nodes.filter(node => !node.parent).map(node => node.id);
  const reportNodeIds = new Set([...topLevelIds, ...directTagIds]);

  const ontologyNodes = Array.from(reportNodeIds)
    .map(nodeId => {
      const node = nodeById.get(nodeId);

      if (!node) {
        return null;
      }

      const covered = descendantsOf(nodeId, childrenOf);
      const matched = questions.filter(question => (question.ontology || []).some(tag => covered.has(tag)));
      const stats = statsForQuestions(matched, submittedAttempts);

      return stats && { id: node.id, kind: node.kind, label: node.label, topLevel: !node.parent, ...stats };
    })
    .filter(Boolean);

  return { outcomes, ontologyNodes };
}

module.exports = { buildOutcomesSummary };
