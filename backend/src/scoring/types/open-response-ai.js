// Reserved question type: named so content and teachers can refer to it, but
// questions of this type are rejected until this file implements a scorer.
// To implement it, replace status with "active" and add publicFields, sample,
// validate, normalizeResponse, recordResponse and score (see ./mcq.js).

module.exports = {
  type: "open-response-ai",
  status: "reserved",
  label: "Open response (AI scored)",
  description: "Free text scored against a rubric by the AI provider (src/ai). Stored as pending at submit, then scored or needs-review."
};
