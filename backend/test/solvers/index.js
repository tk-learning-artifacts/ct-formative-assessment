// All answer-key solvers, keyed by question id. To add a question, add a
// solver to the file for its bank (or a new file listed here). A question that
// genuinely cannot be computed goes in NOT_COMPUTABLE with a reason, which the
// answer-key test prints so it stays visible.

const core = require("./core");
const rgsynapse = require("./rgsynapse");
const typeSamples = require("./type-samples");
const aiSamples = require("./ai-samples");
const codeReading = require("./type-code-reading").SOLVERS;
const blocks = require("./blocks");

const SOLVERS = { ...core, ...rgsynapse, ...typeSamples, ...aiSamples, ...codeReading, ...blocks };

const NOT_COMPUTABLE = {
  // "QUESTION-ID": "why no solver is possible, and who checked the key by hand"
  "RGS-S1-12": "judgement question about preparing AI-generated code for a teammate to read; no key to compute. Checked by hand: renaming and commenting is the option that actually helps a reader, the other three make the code harder to read or skip review.",
  "RGS-S2-09": "judgement question about which project best fits Brennan & Resnick's 'expressing' perspective; no key to compute. Checked by hand: the personally designed poem animation is the only option that is both original and creative, the others are a utility, an unmodified copy, or a routine check."
};

module.exports = {
  SOLVERS,
  NOT_COMPUTABLE
};
