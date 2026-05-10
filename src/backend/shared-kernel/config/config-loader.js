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
  RATE_LIMIT_WINDOW_MS: { type: 'number', default: 900000 },
  RATE_LIMIT_MAX: { type: 'number', default: 100 },
  CORS_ORIGINS: { type: 'csv', default: 'http://localhost:3000' },
  LOG_LEVEL: { type: 'string', default: 'info', enum: ['debug', 'info', 'warn', 'error'] },
  OUTBOX_BATCH_SIZE: { type: 'number', default: 100 },
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
  return Object.freeze(out);
}

/** Returns the schema for documentation / .env.example checks. */
export function getConfigSchema() {
  return SCHEMA;
}
