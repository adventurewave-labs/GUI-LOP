/**
 * retry.js — exponential backoff with full jitter, plus per-attempt timeout
 * via `AbortController`.
 *
 * Designed for the AI ACL: callers pass an `attempt(signal)` function. The
 * runner aborts the in-flight call after `timeoutMs` and retries on
 * "retryable" errors up to `maxRetries` times.
 *
 * A failure is considered retryable when:
 *   - it has `isRetryable === true`, OR
 *   - it is a `AIProviderUnavailable` / `AIQuotaExceeded`, OR
 *   - its `name` is `'AbortError'` (timeout).
 *
 * Non-retryable errors (e.g. `AIInvalidRequest`, `AIBadResponse`) propagate
 * immediately.
 */
import { AIProviderUnavailable, AIQuotaExceeded } from './domain-errors.js';

/** Default retry policy values. Overridable per call. */
export const DEFAULT_RETRY = Object.freeze({
  maxRetries: 2,
  baseDelayMs: 100,
  maxDelayMs: 4000,
  timeoutMs: 30_000,
});

function isRetryable(err) {
  if (!err) return false;
  if (err.isRetryable === true) return true;
  if (err instanceof AIProviderUnavailable) return true;
  if (err instanceof AIQuotaExceeded) return true;
  if (err.name === 'AbortError') return true;
  return false;
}

/** Compute backoff in ms with full jitter. */
export function backoffDelay({ attempt, baseDelayMs, maxDelayMs, rng = Math.random }) {
  const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  return Math.floor(rng() * exp);
}

/**
 * Run `fn(signal)` with retries.
 *
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.maxRetries]
 * @param {number} [opts.baseDelayMs]
 * @param {number} [opts.maxDelayMs]
 * @param {number} [opts.timeoutMs]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {() => number} [opts.rng]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const cfg = { ...DEFAULT_RETRY, ...opts };
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rng = opts.rng ?? Math.random;

  let attempt = 0;
  let lastError;
  // attempts = maxRetries + 1 (the initial try is not a retry).
  for (; attempt <= cfg.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const out = await fn(controller.signal);
      clearTimeout(timeoutId);
      return out;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      if (!isRetryable(err) || attempt === cfg.maxRetries) {
        throw err;
      }
      const delay = backoffDelay({
        attempt,
        baseDelayMs: cfg.baseDelayMs,
        maxDelayMs: cfg.maxDelayMs,
        rng,
      });
      await sleep(delay);
    }
  }
  // Defensive: should be unreachable.
  throw lastError ?? new Error('withRetry: exhausted without a result');
}
