// Index for the AI scoring job (src/ai/jobs.js), which polls answers whose
// score_status is "pending". Pending rows are the job's queue: there is no
// separate queue table, so an answer still pending after a restart is simply
// picked up again.

module.exports = {
  up(db) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_answers_status ON answers (score_status, id)");
  }
};
