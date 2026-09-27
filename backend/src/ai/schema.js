// The structured output an AI provider must return when scoring, and the
// validator applied on receipt. Nothing a model returns is used, stored or
// shown until it passes validateModelScore().
//
// Output shape (no other keys allowed):
//   {
//     "criterionId":  one of the question's rubric criterion ids,
//     "score":        integer equal to that criterion's points (0..maxPoints),
//     "feedbackCode": one of FEEDBACK_CODES,
//     "feedback":     optional, at most FEEDBACK_MAX_CHARS of one-line plain text
//   }
//
// "spec" below is { rubric: [{ id, points }], maxPoints }, which the guarded
// provider takes from the payload built by buildScoringPayload().

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

// Control, format (bidi overrides, zero-width), line/paragraph separator,
// private-use and unassigned characters, plus angle brackets.
const UNSAFE_FEEDBACK_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}<>]/u;

function buildScoreSchema(spec) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["criterionId", "score", "feedbackCode"],
    properties: {
      criterionId: { type: "string", enum: spec.rubric.map(criterion => criterion.id) },
      score: { type: "integer", minimum: 0, maximum: spec.maxPoints },
      feedbackCode: { type: "string", enum: FEEDBACK_CODES },
      feedback: { type: "string", maxLength: FEEDBACK_MAX_CHARS }
    }
  };
}

// Returns { ok: true, value } or { ok: false, errors }.
function validateModelScore(raw, spec) {
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

  const criterion = (spec.rubric || []).find(item => item.id === output.criterionId);

  if (!criterion) {
    errors.push("criterionId is not one of the question's rubric criteria");
  }

  if (!Number.isInteger(output.score) || output.score < 0 || output.score > spec.maxPoints) {
    errors.push(`score must be an integer from 0 to ${spec.maxPoints}`);
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
    } else if (UNSAFE_FEEDBACK_CHARS.test(output.feedback)) {
      errors.push("feedback must be one line of plain text without control or formatting characters");
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
