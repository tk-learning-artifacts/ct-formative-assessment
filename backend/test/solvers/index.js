// All answer-key solvers, keyed by question id. To add a question, add a
// solver to the file for its bank (or a new file listed here). A question that
// genuinely cannot be computed goes in NOT_COMPUTABLE with a reason, which the
// answer-key test prints so it stays visible.

const core = require("./core");
const rgsynapse = require("./rgsynapse");

const SOLVERS = { ...core, ...rgsynapse };

const NOT_COMPUTABLE = {
  // "QUESTION-ID": "why no solver is possible, and who checked the key by hand"
};

module.exports = {
  SOLVERS,
  NOT_COMPUTABLE
};
