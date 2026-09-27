// Background scoring job for AI-scored answers.
//
// At submit an open-response-ai answer is stored with score_status "pending"
// and the student gets their total straight away. This job, running in the
// same process, finds pending answers, scores each through scoreWithAi()
// (which redacts, calls the guarded provider and validates the reply), and
// stores "scored" or "needs-review" plus the detail. The attempt total is
// recomputed in the same transaction.
//
// The answers table is the queue: nothing is held only in memory, so an
// answer that was pending or mid-flight when the server stopped is picked up
// again on the next start. The write only applies while the answer is still
// pending, so a teacher's mark made meanwhile is never overwritten.
//
// With AI_PROVIDER=none every pending answer becomes "needs-review" with
// reason "ai-disabled" on the next pass, without any network call.
//
// Logs carry answer ids only, never names, groups or response text.

const { scoreWithAi } = require("./index");

const DEFAULT_POLL_MS = 5000;

function createScoringQueue({ store, provider, concurrency = 2, pollMs = DEFAULT_POLL_MS, log = () => {} }) {
  const inFlight = new Map();
  // Answers whose result could not be stored. Skipped until the next start,
  // so a database error cannot turn into a tight retry loop.
  const unstored = new Set();
  let timer = null;
  let running = false;
  let idleWaiters = [];

  function storeOpen() {
    return Boolean(store.db && store.db.open);
  }

  function settleIdleWaiters() {
    if (inFlight.size === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach(resolve => resolve());
    }
  }

  async function scoreOne(row) {
    let result;

    try {
      const response = row.response_json ? JSON.parse(row.response_json) : null;

      result = await scoreWithAi({
        provider,
        store,
        eventId: row.event_id,
        questionId: row.question_id,
        responseText: response && typeof response.text === "string" ? response.text : "",
        studentName: row.student_name,
        studentGroup: row.student_group
      });
    } catch (_error) {
      result = { status: "needs-review", earned: 0, detail: { ai: "needs-review", reason: "job-error" } };
    }

    if (!storeOpen()) {
      return;
    }

    try {
      store.completePendingAnswer(row.id, result);
    } catch (error) {
      unstored.add(row.id);
      log(`AI scoring: could not store the result for answer ${row.id} (${error.name}).`);
    }
  }

  // Starts as many pending answers as there are free slots.
  function fill() {
    if (!running || !storeOpen()) {
      settleIdleWaiters();
      return 0;
    }

    const free = concurrency - inFlight.size;

    if (free <= 0) {
      return 0;
    }

    let rows;

    try {
      rows = store.listPendingAnswers(free, Array.from(inFlight.keys()).concat(Array.from(unstored)));
    } catch (error) {
      log(`AI scoring: could not read pending answers (${error.name}).`);
      settleIdleWaiters();
      return 0;
    }

    rows.forEach(row => {
      const job = scoreOne(row).finally(() => {
        inFlight.delete(row.id);
        fill();
        settleIdleWaiters();
      });
      inFlight.set(row.id, job);
    });

    settleIdleWaiters();
    return rows.length;
  }

  return {
    // Picks up anything left pending (including from before a restart) and
    // then polls, in case a kick was missed.
    start() {
      if (running) {
        return;
      }

      running = true;
      timer = setInterval(fill, pollMs);
      timer.unref();
      fill();
    },

    stop() {
      running = false;

      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      settleIdleWaiters();
    },

    // Called after a submit, so new answers do not wait for the next poll.
    kick() {
      fill();
    },

    // Resolves once nothing is pending or in flight. For tests and scripts.
    async drain() {
      for (;;) {
        fill();

        if (inFlight.size === 0) {
          return;
        }

        await new Promise(resolve => idleWaiters.push(resolve));
      }
    },

    get inFlight() {
      return inFlight.size;
    }
  };
}

module.exports = {
  createScoringQueue,
  DEFAULT_POLL_MS
};
