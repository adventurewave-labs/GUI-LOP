/**
 * circuit-breaker.js — a small three-state breaker for the AI ACL.
 *
 * States:
 *   - CLOSED   : calls flow normally. Consecutive failures increment a
 *                counter; when it reaches `failureThreshold`, the breaker
 *                opens.
 *   - OPEN     : calls fail fast with `AIProviderUnavailable`. After
 *                `cooldownMs` since opening, the breaker moves to HALF_OPEN.
 *   - HALF_OPEN: a single probe call is allowed. If it succeeds the breaker
 *                closes; if it fails it re-opens with a fresh cooldown.
 *
 * The breaker only counts failures that look like provider-side problems
 * (`AIProviderUnavailable`, `AIQuotaExceeded`, or anything marked
 * `isProviderFault === true`). Application-side errors like
 * `AIInvalidRequest` do NOT trip the breaker — we don't want a single bad
 * prompt to take the whole provider out.
 */
import { AIProviderUnavailable, AIQuotaExceeded } from './domain-errors.js';

export const STATES = Object.freeze({
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open',
});

function isProviderFault(err) {
  if (!err) return false;
  if (err.isProviderFault === true) return true;
  if (err instanceof AIProviderUnavailable) return true;
  if (err instanceof AIQuotaExceeded) return true;
  return false;
}

export class CircuitBreaker {
  /**
   * @param {object} [opts]
   * @param {number} [opts.failureThreshold]  Consecutive failures before opening.
   * @param {number} [opts.cooldownMs]        Time the breaker stays open before half-open.
   * @param {() => number} [opts.now]         Time source (ms since epoch).
   */
  constructor({ failureThreshold = 5, cooldownMs = 30_000, now = Date.now } = {}) {
    this._failureThreshold = failureThreshold;
    this._cooldownMs = cooldownMs;
    this._now = now;
    this._state = STATES.CLOSED;
    this._consecutiveFailures = 0;
    this._openedAt = 0;
  }

  get state() {
    return this._refresh();
  }

  get consecutiveFailures() {
    return this._consecutiveFailures;
  }

  /** Force-reset to CLOSED (used by tests and admin endpoints). */
  reset() {
    this._state = STATES.CLOSED;
    this._consecutiveFailures = 0;
    this._openedAt = 0;
  }

  /**
   * Run `fn()` through the breaker.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async execute(fn) {
    const state = this._refresh();
    if (state === STATES.OPEN) {
      throw new AIProviderUnavailable('Circuit breaker is open', {
        state,
        cooldownRemainingMs: this._cooldownRemaining(),
      });
    }
    try {
      const out = await fn();
      this._onSuccess();
      return out;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  /* -------- private -------- */

  _refresh() {
    if (this._state === STATES.OPEN && this._cooldownRemaining() <= 0) {
      this._state = STATES.HALF_OPEN;
    }
    return this._state;
  }

  _cooldownRemaining() {
    return Math.max(0, this._openedAt + this._cooldownMs - this._now());
  }

  _onSuccess() {
    this._consecutiveFailures = 0;
    this._state = STATES.CLOSED;
  }

  _onFailure(err) {
    if (!isProviderFault(err)) {
      // Application-side error — do not trip the breaker, but don't reset
      // the success counter either; the call did not actually exercise the
      // provider.
      return;
    }
    this._consecutiveFailures += 1;
    if (
      this._state === STATES.HALF_OPEN
      || this._consecutiveFailures >= this._failureThreshold
    ) {
      this._state = STATES.OPEN;
      this._openedAt = this._now();
    }
  }
}
