// The structured output an AI provider must return when scoring, and the
// validator applied on receipt. Nothing a model returns is used, stored or
// shown until it passes validateModelScore().
//
// Output shape (no other keys allowed):
//   {
//     "criterionId":  one of the question's rubric criterion ids,
//     "score":        integer equal to that criterion's points (0..maxPoints),
//     "feedbackCode": one of FEEDBACK_CODES,
//     "feedback":     optional, at most FEEDBACK_MAX_CHARS, one line of plain text
//   }

const FEEDBACK_CODES = [
  "correct",
  "partially-correct",
  "misconception",
  "incomplete",
  "off-topic",
  "needs-teacher-review"
];

const FEEDBACK_MAX_CHARS = 200;
const OUTPUT_KEYS = ["criterionId", "score", "feedbackCode", "feedback"];

// A JSON Schema the provider adapter passes to the model's structured-output
// mode, built per question so the enums are the question's own rubric ids.
function buildScoreSchema(question) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["criterionId", "score", "feedbackCode"],
    properties: {
      criterionId: { type: "string", enum: question.rubric.map(criterion => criterion.id) },
      score: { type: "integer", minimum: 0, maximum: question.points },
      feedbackCode: { type: "string", enum: FEEDBACK_CODES },
      feedback: { type: "string", maxLength: FEEDBACK_MAX_CHARS }
    }
  };
}

// Returns { ok: true, value } or { ok: false, errors }.
function validateModelScore(raw, question) {
  const errors = [];
  let output = raw;

  if (typeof raw === "string") {
    try {
      output = JSON.parse(raw);
    } catch (_error) {
      return { ok: false, errors: ["output is not valid JSON"] };
    }
  }

  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return { ok: false, errors: ["output must be a JSON object"] };
  }

  Object.keys(output).forEach(key => {
    if (!OUTPUT_KEYS.includes(key)) {
      errors.push(`unexpected key "${key}"`);
    }
  });

  const criterion = (question.rubric || []).find(item => item.id === output.criterionId);

  if (!criterion) {
    errors.push("criterionId is not one of the question's rubric criteria");
  }

  if (!Number.isInteger(output.score) || output.score < 0 || output.score > question.points) {
    errors.push(`score must be an integer from 0 to ${question.points}`);
  } else if (criterion && output.score !== criterion.points) {
    errors.push(`score ${output.score} does not match criterion "${criterion.id}" (${criterion.points} points)`);
  }

  if (!FEEDBACK_CODES.includes(output.feedbackCode)) {
    errors.push("feedbackCode is not a known code");
  }

  if (output.feedback !== undefined) {
    if (typeof output.feedback !== "string") {
      errors.push("feedback must be a string");
    } else if (output.feedback.length > FEEDBACK_MAX_CHARS) {
      errors.push(`feedback is longer than ${FEEDBACK_MAX_CHARS} characters`);
    } else if (/[\u0000-\u001f\u007f<>]/.test(output.feedback)) {
      errors.push("feedback must be one line of plain text");
    }
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  const value = {
    criterionId: output.criterionId,
    score: output.score,
    feedbackCode: output.feedbackCode
  };

  if (output.feedback !== undefined) {
    value.feedback = output.feedback;
  }

  return { ok: true, value };
}

module.exports = {
  FEEDBACK_CODES,
  FEEDBACK_MAX_CHARS,
  buildScoreSchema,
  validateModelScore
};
