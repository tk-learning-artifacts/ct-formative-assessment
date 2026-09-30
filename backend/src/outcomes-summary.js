// Per-outcome and per-ontology-node results summary for one event, built
// from its question snapshot and its submitted attempts. Read-only: no new
// tables, no new columns. Besides the per-outcome and per-node figures it
// returns the whole test (overall), each question (questions) and each
// submitted attempt's own percentages (perAttempt), all under one set of
// rules, so the charts and the per-student view agree with the tables.
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

function isUnmarked(answer) {
  return Boolean(answer.scoreStatus) && answer.scoreStatus !== "scored";
}

// One attempt's result over a group of questions (pointsById: question id to
// points; maxTotal: their sum). An answer that is not marked yet (an
// AI-scored answer still "pending", or "needs-review" until the teacher marks
// it) is left out of the percentage, points and maximum alike. A question
// with no answer row counts as 0, as it does in the attempt's total.
// percent is null when nothing in the group is marked.
function attemptResult(attempt, pointsById, maxTotal) {
  let earned = 0;
  let max = maxTotal;
  let unmarked = 0;

  attempt.answers
    .filter(answer => pointsById.has(answer.questionId))
    .forEach(answer => {
      if (isUnmarked(answer)) {
        unmarked += 1;
        max -= pointsById.get(answer.questionId);
      } else {
        earned += answer.earnedPoints || 0;
      }
    });

  return { percent: max > 0 ? (earned / max) * 100 : null, unmarked };
}

function groupOf(matchedQuestions) {
  return {
    pointsById: new Map(matchedQuestions.map(question => [question.id, question.points || 0])),
    maxTotal: matchedQuestions.reduce((sum, question) => sum + (question.points || 0), 0)
  };
}

// matchedQuestions: the event's snapshot questions tagged with this outcome
// or ontology node. submittedAttempts: every non-reset, submitted attempt
// for the event, each with its per-question answers (from store.getResults).
//
// Unmarked answers are left out (see attemptResult) and counted in
// unmarkedAnswers. Counting them as 0 would drag every AI-tagged outcome
// down, most of all with AI_PROVIDER=none. An attempt with nothing marked in
// this group is left out of the mean and the below-half count.
function statsForQuestions(matchedQuestions, submittedAttempts) {
  const { pointsById, maxTotal } = groupOf(matchedQuestions);

  if (!matchedQuestions.length || maxTotal <= 0) {
    return null;
  }

  let percentSum = 0;
  let markedAttempts = 0;
  let belowHalfCount = 0;
  let lateAttempts = 0;
  let unmarkedAnswers = 0;

  submittedAttempts.forEach(attempt => {
    const { percent, unmarked } = attemptResult(attempt, pointsById, maxTotal);
    unmarkedAnswers += unmarked;

    if (attempt.late) {
      lateAttempts += 1;
    }

    if (percent === null) {
      return;
    }

    percentSum += percent;
    markedAttempts += 1;

    if (percent < 50) {
      belowHalfCount += 1;
    }
  });

  return {
    questionsCovered: matchedQuestions.length,
    submittedAttempts: submittedAttempts.length,
    lateAttempts,
    unmarkedAnswers,
    meanPercentage: markedAttempts ? roundPercent(percentSum / markedAttempts) : null,
    belowHalfCount
  };
}

// One attempt's percentage over a group, rounded, or null (nothing marked,
// or a group worth no points).
function attemptPercent(attempt, group) {
  if (group.maxTotal <= 0) {
    return null;
  }

  const { percent } = attemptResult(attempt, group.pointsById, group.maxTotal);
  return percent === null ? null : roundPercent(percent);
}

// Per question, in snapshot order, under the same rules: unmarked answers
// are left out of the mean and counted separately, a missing answer row
// counts as 0 (skipped), and a question worth no points has no percentage.
function questionStats(questions, submittedAttempts) {
  return questions.map(question => {
    const points = question.points || 0;
    let earnedSum = 0;
    let markedAttempts = 0;
    let answered = 0;
    let skipped = 0;
    let unmarkedAnswers = 0;
    let fullMarks = 0;

    submittedAttempts.forEach(attempt => {
      const answer = attempt.answers.find(item => item.questionId === question.id);
      const blank = !answer || answer.response === null || answer.response === undefined;

      if (!blank) {
        answered += 1;
      }

      if (answer && isUnmarked(answer)) {
        unmarkedAnswers += 1;
        return;
      }

      markedAttempts += 1;

      if (blank) {
        skipped += 1;
      }

      const earned = answer ? answer.earnedPoints || 0 : 0;
      earnedSum += earned;

      if (points > 0 && earned >= points) {
        fullMarks += 1;
      }
    });

    const meanEarned = markedAttempts ? roundPercent(earnedSum / markedAttempts) : null;

    return {
      id: question.id,
      title: question.title,
      type: question.type,
      maxPoints: points,
      submittedAttempts: submittedAttempts.length,
      markedAttempts,
      answered,
      skipped,
      unmarkedAnswers,
      fullMarks,
      meanEarned,
      percentage: markedAttempts && points > 0 ? roundPercent((earnedSum / markedAttempts / points) * 100) : null
    };
  });
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

  // Each reported group keeps its matched questions, so the per-attempt
  // breakdown below uses exactly the sets the class figures use.
  const outcomeGroups = [];
  const outcomes = store.content.outcomes
    .map(outcome => {
      const matched = questions.filter(question => (question.outcomes || []).includes(outcome.id));
      const stats = statsForQuestions(matched, submittedAttempts);

      if (stats) {
        outcomeGroups.push({ id: outcome.id, group: groupOf(matched) });
      }

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

  const nodeGroups = [];
  const ontologyNodes = Array.from(reportNodeIds)
    .map(nodeId => {
      const node = nodeById.get(nodeId);

      if (!node) {
        return null;
      }

      const covered = descendantsOf(nodeId, childrenOf);
      const matched = questions.filter(question => (question.ontology || []).some(tag => covered.has(tag)));
      const stats = statsForQuestions(matched, submittedAttempts);

      if (stats) {
        nodeGroups.push({ id: node.id, group: groupOf(matched) });
      }

      return stats && { id: node.id, kind: node.kind, label: node.label, topLevel: !node.parent, ...stats };
    })
    .filter(Boolean);

  // Added for the results charts and the per-student view; the two fields
  // above are unchanged. overall is the whole test under the same rules
  // (null when the test is worth no points).
  const allQuestions = groupOf(questions);
  const overall = statsForQuestions(questions, submittedAttempts);
  const perAttempt = submittedAttempts.map(attempt => ({
    attemptId: attempt.id,
    percentage: attemptPercent(attempt, allQuestions),
    outcomes: outcomeGroups.map(({ id, group }) => ({ id, percentage: attemptPercent(attempt, group) })),
    nodes: nodeGroups.map(({ id, group }) => ({ id, percentage: attemptPercent(attempt, group) }))
  }));

  return {
    outcomes,
    ontologyNodes,
    overall,
    questions: questionStats(questions, submittedAttempts),
    perAttempt
  };
}

module.exports = { buildOutcomesSummary };
