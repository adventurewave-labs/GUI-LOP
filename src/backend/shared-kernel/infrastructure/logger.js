/**
 * Tiny structured logger — emits one JSON line per record on stdout/stderr.
 * Intentionally dependency-free; replace with pino if/when needed.
 *
 * Every record is enriched with the ambient request context
 * (`request_id`, `user_id`, `trace_id`, …) and passed through a redactor so
 * credentials never reach log storage, whichever call site forgot.
 */
import { getContext } from './request-context.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are always replaced, matched case-insensitively. */
const SENSITIVE_KEY_RE =
  /^(authorization|cookie|set-cookie|password|passwd|secret|client_secret|token|access_token|refresh_token|id_token|api[-_]?key|x-api-key|jwt|private[-_]?key)$/i;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

function levelEnabled(current, requested) {
  return (LEVELS[requested] ?? 0) >= (LEVELS[current] ?? LEVELS.info);
}

/**
 * Deep-copy `value`, redacting sensitive keys, serialising Errors and
 * breaking cycles. Exported for tests and for ad-hoc use by adapters.
 */
export function redact(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code, stack: value.stack };
  }
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
}

function emit(level, msg, fields) {
  const ctx = getContext();
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx ? redact(ctx) : {}),
    ...(fields && typeof fields === 'object' ? redact(fields) : {}),
  };
  let line;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({ ts: record.ts, level, msg, log_error: 'unserialisable fields' });
  }
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(line + '\n');
}

/**
 * Create a logger bound to a minimum level and optional default fields.
 * @param {{ level?: string, base?: object }} [opts]
 */
export function createLogger(opts = {}) {
  const level = opts.level ?? process.env.LOG_LEVEL ?? 'info';
  const base = opts.base ?? {};
  const log = (lvl, msg, fields) => {
    if (!levelEnabled(level, lvl)) return;
    emit(lvl, msg, { ...base, ...(fields || {}) });
  };
  return {
    level,
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    child: (extra) => createLogger({ level, base: { ...base, ...extra } }),
  };
}
