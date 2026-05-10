import { ValidationError } from '../errors.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALNUM_RE = /^[A-Za-z0-9]{16,64}$/;

/**
 * IdempotencyKey — accepted on mutating endpoints (ADR 0024).
 * Either a UUID (any version) or 16–64 alphanumeric characters.
 */
export class IdempotencyKey {
  /**
   * @param {string} value
   */
  constructor(value) {
    if (typeof value !== 'string') {
      throw new ValidationError('IdempotencyKey requires a string');
    }
    if (!UUID_RE.test(value) && !ALNUM_RE.test(value)) {
      throw new ValidationError(
        'IdempotencyKey must be a UUID or 16-64 alphanumeric characters',
        { value },
      );
    }
    this._value = value;
    Object.freeze(this);
  }

  /** Convenience factory mirroring other VO constructors. */
  static from(value) {
    return new IdempotencyKey(value);
  }

  /** Underlying string form. */
  toString() {
    return this._value;
  }

  /** JSON serialises as the bare string. */
  toJSON() {
    return this._value;
  }

  /** Value-equality against another IdempotencyKey. */
  equals(other) {
    return other instanceof IdempotencyKey && other._value === this._value;
  }
}
