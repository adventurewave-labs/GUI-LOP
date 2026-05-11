/**
 * base-ai-adapter.js — composes the cross-cutting concerns (retry, circuit
 * breaker, telemetry, PII scrubbing) around a vendor-specific subclass.
 *
 * Subclasses implement:
 *   - `_callGenerateUI({ spec, context, strategyHints, signal })` returning
 *     a `UIDocumentDraft`.
 *   - `_callClassify({ input, labels, options, signal })` returning a
 *     `ClassificationResult`.
 *   - `_callHealthCheck({ signal })` returning a small probe result.
 *   - `name` and `model` getters used in telemetry.
 *
 * The base class:
 *   - Scrubs PII from `spec`, `context`, and classification `input` before
 *     handing them to the subclass.
 *   - Wraps every vendor call with telemetry, retry, and the circuit
 *     breaker — in that order.
 *
 * The composition order matters:
 *   telemetry( circuitBreaker( retry( vendor ) ) )
 * so that:
 *   - telemetry measures the total time the caller waits;
 *   - the circuit breaker observes the same failure the caller observes
 *     (so transient retries don't open it on the first attempt);
 *   - retry is closest to the vendor call.
 */
import { AIProvider } from '../../application/ports/ai-provider.js';
import { withRetry } from './retry.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { withTelemetry } from './telemetry.js';
import { scrub } from './pii-scrubber.js';

const NOOP_LOGGER = Object.freeze({ info: () => {}, warn: () => {}, error: () => {} });

export class BaseAIAdapter extends AIProvider {
  /**
   * @param {object} [opts]
   * @param {object} [opts.logger]                       Structured logger.
   * @param {object} [opts.retry]                        See `retry.js`.
   * @param {object} [opts.circuitBreaker]               Pre-built breaker.
   * @param {object} [opts.circuitBreakerOptions]        Used if no breaker passed.
   * @param {boolean} [opts.scrubPii]                    Default true.
   */
  constructor(opts = {}) {
    super();
    this._logger = opts.logger ?? NOOP_LOGGER;
    this._retry = opts.retry ?? {};
    this._scrubPii = opts.scrubPii !== false;
    this._breaker = opts.circuitBreaker
      ?? new CircuitBreaker(opts.circuitBreakerOptions ?? {});
  }

  /** Telemetry-friendly vendor name. Subclasses override. */
  get name() { return 'unknown'; }

  /** Active vendor model id. Subclasses override. */
  get model() { return 'unknown'; }

  /* -------- AIProvider implementation -------- */

  async generateUI(input) {
    const safeInput = this._scrubInputs(input ?? {});
    return this._runWithGuards('generate_ui', (signal) =>
      this._callGenerateUI({ ...safeInput, signal }),
    );
  }

  async classify(input) {
    const safeInput = this._scrubInputs(input ?? {});
    return this._runWithGuards('classify', (signal) =>
      this._callClassify({ ...safeInput, signal }),
    );
  }

  async healthCheck() {
    return this._runWithGuards('health_check', (signal) =>
      this._callHealthCheck({ signal }),
    );
  }

  /* -------- subclass hooks (default no-op) -------- */

  // eslint-disable-next-line no-unused-vars
  async _callGenerateUI(_args) {
    throw new Error(`${this.name}._callGenerateUI not implemented`);
  }

  // eslint-disable-next-line no-unused-vars
  async _callClassify(_args) {
    throw new Error(`${this.name}._callClassify not implemented`);
  }

  // eslint-disable-next-line no-unused-vars
  async _callHealthCheck(_args) {
    throw new Error(`${this.name}._callHealthCheck not implemented`);
  }

  /* -------- internals -------- */

  _scrubInputs(input) {
    if (!this._scrubPii) return input;
    const out = { ...input };
    if (out.spec !== undefined) out.spec = scrub(out.spec);
    if (out.context !== undefined) out.context = scrub(out.context);
    if (out.input !== undefined) out.input = scrub(out.input);
    return out;
  }

  _runWithGuards(op, run) {
    const meta = { provider: this.name, model: this.model, op };
    return withTelemetry(
      () => this._breaker.execute(
        () => withRetry((signal) => run(signal), this._retry),
      ),
      meta,
      { logger: this._logger },
    );
  }
}
