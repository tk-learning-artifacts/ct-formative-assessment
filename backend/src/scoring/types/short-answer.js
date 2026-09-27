// Reserved question type: named so content and teachers can refer to it, but
// questions of this type are rejected until this file implements a scorer.
// To implement it, replace status with "active" and add publicFields, sample,
// validate, normalizeResponse, recordResponse and score (see ./mcq.js).

module.exports = {
  type: "short-answer",
  status: "reserved",
  label: "Short answer",
  description: "A typed word or number matched against a list of accepted answers."
};
