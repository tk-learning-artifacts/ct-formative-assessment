// OpenRouter adapter: sends one scoring request to OpenRouter's chat
// completions API and returns the model's structured output.
//
// This file only transports. The guarded provider in ../index.js builds the
// whole request ({ system, payload, schema, maxTokens }) and is the only
// caller; this adapter refuses any other shape, maps those four fields onto
// OpenRouter's wire format and adds nothing that came from a caller. The
// payload has already been redacted by ../payload.js.
//
// Request options fixed here:
// - response_format json_schema with strict: true, using the guard's schema;
// - provider.require_parameters, so OpenRouter only routes to endpoints that
//   support structured output;
// - provider.data_collection "deny" and provider.zdr, so it only routes to
//   endpoints that neither train on nor retain the request;
// - the guard's max_tokens. No temperature: none of the current Claude
//   endpoints on OpenRouter list it as supported, so with
//   require_parameters it would rule out every endpoint. The rubric and the
//   schema decide the score, not sampling.
//
// Only parameters the chosen model's endpoints list in supported_parameters
// may be added here, for the same reason.
//
// Retries: 408, 429 and 5xx responses and network failures are retried with
// exponential backoff (Retry-After is honoured, capped), at most maxRetries
// times. A timeout is not retried, so one answer never holds a worker for
// more than about timeoutMs x (maxRetries + 1).

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Chosen from GET https://openrouter.ai/api/v1/models on 2026-09-27: a
// current Claude model whose supported_parameters list both
// "structured_outputs" and "response_format", with zero-data-retention
// endpoints that also support structured output. See the ADR, section 10.
const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;
const REQUEST_KEYS = ["maxTokens", "payload", "schema", "system"];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryable(status) {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelay(attempt, response) {
  const header = response && response.headers && response.headers.get("retry-after");
  const seconds = header !== null && header !== undefined && /^\d+(\.\d+)?$/.test(header) ? Number(header) : null;
  const ms = seconds !== null ? seconds * 1000 : BACKOFF_BASE_MS * 2 ** attempt;
  return Math.min(ms, BACKOFF_CAP_MS);
}

class ProviderError extends Error {
  constructor(message, { status = null, retry = false } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retry = retry;
  }
}

function createOpenRouterAdapter(config, deps = {}) {
  const model = config.model || DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRetries = Number.isInteger(config.maxRetries) ? config.maxRetries : DEFAULT_MAX_RETRIES;
  const referer = config.appUrl || "http://localhost";
  const wait = deps.sleep || sleep;

  function buildBody(request) {
    return JSON.stringify({
      model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: JSON.stringify(request.payload) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "ct_quest_score", strict: true, schema: request.schema }
      },
      max_tokens: request.maxTokens,
      provider: {
        require_parameters: true,
        data_collection: "deny",
        zdr: true
      }
    });
  }

  async function send(body) {
    // Looked up per call, so a test can replace the global fetch.
    const doFetch = deps.fetch || globalThis.fetch;
    let response;

    try {
      response = await doFetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": referer,
          "X-Title": "CT Quest"
        },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ProviderError("OpenRouter request timed out");
      }
      throw new ProviderError("OpenRouter request failed", { retry: true });
    }

    if (!response.ok) {
      throw Object.assign(new ProviderError(`OpenRouter returned HTTP ${response.status}`, {
        status: response.status,
        retry: retryable(response.status)
      }), { response });
    }

    let data;

    try {
      data = await response.json();
    } catch (_error) {
      throw new ProviderError("OpenRouter reply was not JSON");
    }

    // OpenRouter can report an upstream failure inside a 200 reply.
    if (data && data.error) {
      const status = Number(data.error.code) || null;
      throw new ProviderError(`OpenRouter reported an error${status ? ` (${status})` : ""}`, {
        status,
        retry: status !== null && retryable(status)
      });
    }

    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const content = choice && choice.message ? choice.message.content : null;

    if (!choice || typeof content !== "string" || !content.trim()) {
      throw new ProviderError("OpenRouter reply had no content");
    }

    if (choice.finish_reason === "length") {
      throw new ProviderError("OpenRouter reply was cut off at max_tokens");
    }

    return { output: content, model: typeof data.model === "string" ? data.model : model };
  }

  return {
    model,

    async complete(request) {
      const keys = Object.keys(request || {}).sort();

      if (keys.join(",") !== REQUEST_KEYS.join(",")) {
        throw new Error("The OpenRouter adapter only sends requests built by the guarded provider.");
      }

      const body = buildBody(request);

      for (let attempt = 0; ; attempt += 1) {
        try {
          return await send(body);
        } catch (error) {
          if (!(error instanceof ProviderError) || !error.retry || attempt >= maxRetries) {
            throw error;
          }

          await wait(retryDelay(attempt, error.response));
        }
      }
    }
  };
}

module.exports = {
  createOpenRouterAdapter,
  ProviderError,
  ENDPOINT,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES
};
