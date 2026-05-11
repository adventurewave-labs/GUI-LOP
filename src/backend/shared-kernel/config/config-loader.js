/**
 * config-loader — single, schema-validated entry point for environment config
 * (ADR 0022). The only place in the codebase permitted to read process.env.
 */

/** Raised when configuration is missing or malformed. */
export class ConfigError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ConfigError';
    this.code = 'CONFIG_INVALID';
    this.details = details;
  }
}

/** Schema entries: type, optional default, required flag, parser. */
const SCHEMA = {
  NODE_ENV: { type: 'string', default: 'development' },
  PORT: { type: 'number', default: 3001 },
  DATABASE_URL: { type: 'string', required: false },
  REDIS_URL: { type: 'string', required: false },
  JWT_SECRET: { type: 'string', required: true, secret: true },
  JWT_ACCESS_TTL_SECONDS: { type: 'number', default: 900 },
  JWT_REFRESH_TTL_SECONDS: { type: 'number', default: 604800 },
  BCRYPT_WORK_FACTOR: { type: 'number', default: 12 },
  /**
   * Override BCRYPT_WORK_FACTOR when NODE_ENV === 'test'. Defaults to 4 so
   * test suites don't pay 150-300 ms per hash. Production picks
   * BCRYPT_WORK_FACTOR (default 12); the bcrypt-password-hasher uses a
   * worker-thread pool so factor 12 doesn't block the event loop.
   */
  BCRYPT_WORK_FACTOR_TEST: { type: 'number', default: 4 },
  RATE_LIMIT_WINDOW_MS: { type: 'number', default: 900000 },
  RATE_LIMIT_MAX: { type: 'number', default: 100 },
  CORS_ORIGINS: { type: 'csv', default: 'http://localhost:3000' },
  LOG_LEVEL: { type: 'string', default: 'info', enum: ['debug', 'info', 'warn', 'error'] },
  /**
   * Number of outbox rows fetched per consumer tick. Tuned via
   * `tests/benchmarks/scenarios/eventbus-throughput.bench.js` against the
   * `outbox.publish[N]` drain SLOs. 200 outperformed 50/100/500 because:
   * - 50 wastes too many round-trips per drain.
   * - 500 spends most of the tick in a single batch and starves shutdown.
   * - 200 keeps throughput high while bounding per-tick memory.
   */
  OUTBOX_BATCH_SIZE: { type: 'number', default: 200 },

  /* -------- AI Provider ACL (ADR 0023) -------- */
  /**
   * Which AI vendor adapter the UI Generation context uses.
   *   - `stub`     : in-memory deterministic; default; no API key required.
   *   - `openai`   : OpenAI Chat Completions adapter.
   *   - `anthropic`: Anthropic Messages adapter (claude-haiku-4-5 default).
   * When set to a real vendor, `AI_API_KEY` becomes required at bootstrap.
   */
  AI_PROVIDER: { type: 'string', default: 'stub', enum: ['stub', 'openai', 'anthropic'] },
  /**
   * API key for the active AI provider. Validated by the bootstrap (we keep
   * `required: false` here so the in-memory/stub default boots without it).
   */
  AI_API_KEY: { type: 'string', required: false, secret: true },
  /** Optional override of the vendor base URL (proxy, gateway, mock server). */
  AI_BASE_URL: { type: 'string', required: false },
  /** Optional override of the vendor model id. */
  AI_MODEL: { type: 'string', required: false },
  /** Per-call timeout enforced via AbortController. Default 30s. */
  AI_TIMEOUT_MS: { type: 'number', default: 30000 },
  /** Number of retries (initial try not counted). Default 2. */
  AI_MAX_RETRIES: { type: 'number', default: 2 },
};

function coerce(name, raw, spec) {
  if (raw === undefined || raw === null || raw === '') {
    if (spec.default !== undefined) {
      // Run defaults through the same parser so "csv"/"number" defaults
      // produce typed values rather than the raw string.
      return coerceValue(name, spec.default, spec);
    }
    if (spec.required) {
      throw new ConfigError(`Missing required env var: ${name}`, { name });
    }
    return null;
  }
  return coerceValue(name, raw, spec);
}

function coerceValue(name, raw, spec) {
  switch (spec.type) {
    case 'string': {
      const v = String(raw);
      if (spec.enum && !spec.enum.includes(v)) {
        throw new ConfigError(`Env var ${name} must be one of ${spec.enum.join(', ')}`, {
          name,
          value: v,
          allowed: spec.enum,
        });
      }
      return v;
    }
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new ConfigError(`Env var ${name} must be a number`, { name, value: raw });
      }
      if (!Number.isInteger(n)) {
        throw new ConfigError(`Env var ${name} must be an integer`, { name, value: raw });
      }
      if (n < 0) {
        throw new ConfigError(`Env var ${name} must be non-negative`, { name, value: raw });
      }
      return n;
    }
    case 'csv': {
      return String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    default:
      throw new ConfigError(`Unknown schema type for ${name}: ${spec.type}`);
  }
}

/**
 * Load + validate config from a source object (defaults to process.env).
 * Returns a frozen plain object. Throws ConfigError on any problem.
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const out = {};
  const errors = [];
  for (const [name, spec] of Object.entries(SCHEMA)) {
    try {
      out[name] = coerce(name, env[name], spec);
    } catch (e) {
      errors.push(e);
    }
  }
  if (errors.length > 0) {
    const msg = errors.map((e) => `- ${e.message}`).join('\n');
    throw new ConfigError(`Invalid configuration:\n${msg}`, {
      errors: errors.map((e) => ({ message: e.message, ...e.details })),
    });
  }
  // Test-environment override: when NODE_ENV === 'test' AND the caller did
  // not explicitly set BCRYPT_WORK_FACTOR, fall back to the test factor so
  // the suite isn't dominated by bcrypt cost. An explicit BCRYPT_WORK_FACTOR
  // in the env is always honored.
  if (out.NODE_ENV === 'test' && env.BCRYPT_WORK_FACTOR === undefined) {
    out.BCRYPT_WORK_FACTOR = out.BCRYPT_WORK_FACTOR_TEST;
  }
  return Object.freeze(out);
}

/** Returns the schema for documentation / .env.example checks. */
export function getConfigSchema() {
  return SCHEMA;
}
