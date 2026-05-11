/**
 * telemetry.js — wraps an AI call with a structured log line. Emits one
 * record per call with `{ provider, model, op, durationMs, tokenUsage?,
 * error? }` so operators can chart latency and error rates per vendor.
 *
 * The logger is the only allowed source of `console.*` in this tree
 * (composed via the structured logger from the shared kernel).
 */

const NOOP_LOGGER = Object.freeze({
  info: () => {},
  warn: () => {},
  error: () => {},
});

/**
 * Run `fn()` and emit a telemetry log line.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ provider: string, model: string, op: string }} meta
 * @param {{ logger?: object, now?: () => number, tokenUsage?: (out: T) => object }} [opts]
 * @returns {Promise<T>}
 */
export async function withTelemetry(fn, meta, opts = {}) {
  const logger = opts.logger ?? NOOP_LOGGER;
  const now = opts.now ?? (() => Date.now());
  const start = now();
  try {
    const out = await fn();
    const durationMs = now() - start;
    const tokenUsage = opts.tokenUsage ? safe(opts.tokenUsage, out) : extractUsage(out);
    logger.info?.('ai.call', {
      provider: meta.provider,
      model: meta.model,
      op: meta.op,
      durationMs,
      ok: true,
      ...(tokenUsage ? { tokenUsage } : {}),
    });
    return out;
  } catch (err) {
    const durationMs = now() - start;
    logger.error?.('ai.call', {
      provider: meta.provider,
      model: meta.model,
      op: meta.op,
      durationMs,
      ok: false,
      error: errToShape(err),
    });
    throw err;
  }
}

function safe(fn, x) {
  try { return fn(x); } catch { return undefined; }
}

function extractUsage(out) {
  if (!out || typeof out !== 'object') return undefined;
  return out.tokenUsage ?? undefined;
}

function errToShape(err) {
  if (!err) return { name: 'unknown' };
  return {
    name: err.name ?? 'Error',
    code: err.code,
    message: err.message,
  };
}
