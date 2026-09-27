// Reserved question type: named so content and teachers can refer to it, but
// questions of this type are rejected until this file implements a scorer.
// To implement it, replace status with "active" and add publicFields, sample,
// validate, normalizeResponse, recordResponse and score (see ./mcq.js).

module.exports = {
  type: "multi-select",
  status: "reserved",
  label: "Multiple select",
  description: "Pick every correct option; partial credit rules to be decided."
};
