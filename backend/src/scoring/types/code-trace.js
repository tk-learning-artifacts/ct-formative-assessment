// Reserved question type: named so content and teachers can refer to it, but
// questions of this type are rejected until this file implements a scorer.
// To implement it, replace status with "active" and add publicFields, sample,
// validate, normalizeResponse, recordResponse and score (see ./mcq.js).

module.exports = {
  type: "code-trace",
  status: "reserved",
  label: "Code trace",
  description: "Student types the output of a program; compared after whitespace normalisation."
};
