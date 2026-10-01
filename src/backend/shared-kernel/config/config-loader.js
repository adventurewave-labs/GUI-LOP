// @ts-check
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
const SCHEMA = /** @type {const} */ ({
  NODE_ENV: { type: 'string', default: 'development' },
  PORT: { type: 'number', default: 3001 },
  DATABASE_URL: { type: 'string', required: false },
  REDIS_URL: { type: 'string', required: false },
  /* -------- Postgres session safety (roadmap 21; see pg-pool.js) -------- */
  /**
   * Connections per process. Keep replicas × DB_POOL_MAX (+ migrations,
   * admin) under the server's max_connections (Railway/Postgres default 100).
   */
  DB_POOL_MAX: { type: 'number', default: 10 },
  DB_POOL_IDLE_TIMEOUT_MS: { type: 'number', default: 10000 },
  /** Max wait to acquire a connection; fail fast (503) rather than queue forever. */
  DB_CONNECT_TIMEOUT_MS: { type: 'number', default: 5000 },
  /** Recycle connections (picks up failover / DNS changes). 0 = never. */
  DB_POOL_MAX_LIFETIME_S: { type: 'number', default: 1800 },
  /** Server-side per-statement limit. 0 disables. */
  DB_STATEMENT_TIMEOUT_MS: { type: 'number', default: 15000 },
  /** Max wait for a row/table lock. 0 disables. */
  DB_LOCK_TIMEOUT_MS: { type: 'number', default: 5000 },
  /** Reap transactions left open by a crashed/hung handler. 0 disables. */
  DB_IDLE_IN_TX_TIMEOUT_MS: { type: 'number', default: 30000 },
  DB_APPLICATION_NAME: { type: 'string', default: 'gui-lop-api' },
  JWT_SECRET: { type: 'string', required: true, secret: true },
  JWT_ACCESS_TTL_SECONDS: { type: 'number', default: 900 },
  JWT_REFRESH_TTL_SECONDS: { type: 'number', default: 604800 },
  BCRYPT_WORK_FACTOR: { type: 'number', default: 12 },
  /**
   * NIST SP 800-63B rev. 4: 15 when the password is the only factor (today);
   * may drop to 8 (the floor) once MFA exists. See password-policy.js.
   */
  PASSWORD_MIN_LENGTH: { type: 'number', default: 15 },
  /**
   * Override BCRYPT_WORK_FACTOR when NODE_ENV === 'test'. Defaults to 4 so
   * test suites don't pay 150-300 ms per hash. Production picks
   * BCRYPT_WORK_FACTOR (default 12); the bcrypt-password-hasher uses a
   * worker-thread pool so factor 12 doesn't block the event loop.
   */
  BCRYPT_WORK_FACTOR_TEST: { type: 'number', default: 4 },
  /**
   * General /api/v1 budget per client IP (ADR 0015). Previously declared
   * but never enforced; defaults sized for an interactive SPA (10 req/s
   * sustained) rather than the old 100 per 15 min, which would throttle
   * normal dashboard use. Auth routes carry their own stricter limits.
   */
  RATE_LIMIT_WINDOW_MS: { type: 'number', default: 60000 },
  RATE_LIMIT_MAX: { type: 'number', default: 600 },
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
  /** Insert missing built-in workflow templates at boot (Postgres; never overwrites). */
  SEED_DEFAULT_TEMPLATES: { type: 'boolean', default: true },

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
  /** Optional cheaper/faster model for the classify op (defaults to AI_MODEL). */
  AI_MODEL_CLASSIFY: { type: 'string', required: false },
  /** Per-call timeout enforced via AbortController. Default 30s. */
  AI_TIMEOUT_MS: { type: 'number', default: 30000 },
  /** Number of retries (initial try not counted). Default 2. */
  AI_MAX_RETRIES: { type: 'number', default: 2 },

  /* -------- HTTP server hardening -------- */
  /**
   * Allow the legacy `X-User-Id` header to authenticate WebSocket upgrades.
   * Dev-only escape hatch; refused at load time when NODE_ENV=production.
   * Default false: upgrades must carry a verifiable access token.
   */
  WS_ALLOW_HEADER_AUTH: { type: 'boolean', default: false },
  /** Live WebSocket connections allowed per principal (429 beyond). */
  WS_MAX_CONNECTIONS_PER_USER: { type: 'number', default: 10 },
  /** Max inbound WebSocket frame size; larger frames close with 1009. */
  WS_MAX_PAYLOAD_BYTES: { type: 'number', default: 65536 },
  /** Max time to receive the full request headers (slowloris guard). */
  HTTP_HEADERS_TIMEOUT_MS: { type: 'number', default: 15000 },
  /** Max time to receive the full request (headers + body). */
  HTTP_REQUEST_TIMEOUT_MS: { type: 'number', default: 30000 },
  /**
   * Idle keep-alive timeout. Must exceed the upstream LB idle timeout
   * (AWS ALB default 60s) to avoid sporadic 502s on reused sockets.
   */
  HTTP_KEEPALIVE_TIMEOUT_MS: { type: 'number', default: 65000 },
  /**
   * Express `trust proxy` setting. `false` (default) | `true` | hop count
   * (e.g. `1`) | CSV of subnets. Required behind an LB for correct req.ip
   * (rate limiting, audit trail).
   */
  TRUST_PROXY: { type: 'string', default: 'false' },

  /* -------- metrics -------- */
  /** Expose Prometheus metrics at GET /metrics. */
  METRICS_ENABLED: { type: 'boolean', default: true },
  /**
   * Bearer token required to scrape /metrics. When unset, /metrics is
   * open in non-production and 404 in production (fail closed).
   */
  METRICS_TOKEN: { type: 'string', required: false, secret: true },

  /* -------- graceful shutdown -------- */
  /**
   * After SIGTERM, keep serving while /readyz reports 503 so the LB /
   * kube-proxy removes this endpoint before we stop accepting. Must be
   * ≥ endpoint-propagation latency (~2-5s on most clusters).
   */
  SHUTDOWN_DRAIN_DELAY_MS: { type: 'number', default: 5000 },
  /**
   * Hard deadline for the whole shutdown sequence. Must be below the pod's
   * terminationGracePeriodSeconds (default 30s) or SIGKILL wins.
   */
  SHUTDOWN_TIMEOUT_MS: { type: 'number', default: 25000 },
});

/**
 * Value type for one schema entry.
 * @template S
 * @typedef {S extends { type: 'number' } ? number
 *   : S extends { type: 'boolean' } ? boolean
 *   : S extends { type: 'csv' } ? string[]
 *   : S extends { enum: readonly (infer E)[] } ? E
 *   : string} ConfigValue
 */

/**
 * The loaded configuration, derived from SCHEMA so the type cannot drift
 * from the loader: entries with a default or `required: true` are always
 * present; optional entries without a default may be `null`.
 * @typedef {{ readonly [K in keyof typeof SCHEMA]:
 *   (typeof SCHEMA)[K] extends { default: any } | { required: true }
 *     ? ConfigValue<(typeof SCHEMA)[K]>
 *     : ConfigValue<(typeof SCHEMA)[K]> | null }} AppConfig
 */

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
    case 'boolean': {
      const v = String(raw).trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(v)) return true;
      if (['false', '0', 'no', 'off'].includes(v)) return false;
      throw new ConfigError(`Env var ${name} must be a boolean`, { name, value: raw });
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
 * @returns {AppConfig}
 */
export function loadConfig(env = process.env) {
  /** @type {Record<string, any>} */
  const out = {};
  /** @type {any[]} */
  const errors = [];
  for (const [name, spec] of Object.entries(SCHEMA)) {
    try {
      out[name] = coerce(name, env[name], spec);
    } catch (e) {
      errors.push(e);
    }
  }
  // Cross-field invariants.
  if (out.NODE_ENV === 'production' && out.WS_ALLOW_HEADER_AUTH === true) {
    errors.push(
      new ConfigError('WS_ALLOW_HEADER_AUTH must not be enabled when NODE_ENV=production', {
        name: 'WS_ALLOW_HEADER_AUTH',
      }),
    );
  }
  if (
    Number.isInteger(out.HTTP_HEADERS_TIMEOUT_MS) &&
    Number.isInteger(out.HTTP_REQUEST_TIMEOUT_MS) &&
    out.HTTP_REQUEST_TIMEOUT_MS > 0 &&
    out.HTTP_HEADERS_TIMEOUT_MS > out.HTTP_REQUEST_TIMEOUT_MS
  ) {
    errors.push(
      new ConfigError('HTTP_HEADERS_TIMEOUT_MS must not exceed HTTP_REQUEST_TIMEOUT_MS', {
        name: 'HTTP_HEADERS_TIMEOUT_MS',
      }),
    );
  }
  if (
    Number.isInteger(out.SHUTDOWN_DRAIN_DELAY_MS) &&
    Number.isInteger(out.SHUTDOWN_TIMEOUT_MS) &&
    out.SHUTDOWN_DRAIN_DELAY_MS >= out.SHUTDOWN_TIMEOUT_MS
  ) {
    errors.push(
      new ConfigError('SHUTDOWN_DRAIN_DELAY_MS must be less than SHUTDOWN_TIMEOUT_MS', {
        name: 'SHUTDOWN_DRAIN_DELAY_MS',
      }),
    );
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
  return /** @type {AppConfig} */ (Object.freeze(out));
}

/** Returns the schema for documentation / .env.example checks. */
export function getConfigSchema() {
  return SCHEMA;
}
