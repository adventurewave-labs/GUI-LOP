import { ValidationError } from '../errors.js';

/**
 * Timestamp — wraps an ISO-8601 instant. Comparable and immutable.
 * Domain code must obtain "now" via the Clock port, not Date.now().
 */
export class Timestamp {
  /** @private */
  constructor(iso, epochMs) {
    this._iso = iso;
    this._epochMs = epochMs;
    Object.freeze(this);
  }

  /**
   * Wrap an ISO-8601 string after validation.
   * @param {string} iso
   * @returns {Timestamp}
   */
  static from(iso) {
    if (typeof iso !== 'string') {
      throw new ValidationError('Timestamp.from requires an ISO-8601 string');
    }
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) {
      throw new ValidationError('Invalid ISO-8601 timestamp', { value: iso });
    }
    return new Timestamp(new Date(ms).toISOString(), ms);
  }

  /**
   * Read "now" from an injected Clock port.
   * @param {{ now: () => Date }} clock
   * @returns {Timestamp}
   */
  static now(clock) {
    if (!clock || typeof clock.now !== 'function') {
      throw new ValidationError('Timestamp.now requires a Clock with now()');
    }
    const d = clock.now();
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
      throw new ValidationError('Clock.now() must return a valid Date');
    }
    return new Timestamp(d.toISOString(), d.getTime());
  }

  /** Canonical ISO-8601 string form. */
  toISOString() {
    return this._iso;
  }

  /** Epoch milliseconds. */
  toEpochMs() {
    return this._epochMs;
  }

  /** JSON serialises as the ISO string. */
  toJSON() {
    return this._iso;
  }

  /** True when this instant equals `other`. */
  equals(other) {
    return other instanceof Timestamp && other._epochMs === this._epochMs;
  }

  /** -1 / 0 / 1 ordering against `other`. */
  compareTo(other) {
    if (!(other instanceof Timestamp)) {
      throw new ValidationError('Timestamp.compareTo requires another Timestamp');
    }
    if (this._epochMs < other._epochMs) return -1;
    if (this._epochMs > other._epochMs) return 1;
    return 0;
  }

  /** True when this instant precedes `other`. */
  isBefore(other) {
    return this.compareTo(other) < 0;
  }

  /** True when this instant follows `other`. */
  isAfter(other) {
    return this.compareTo(other) > 0;
  }
}
