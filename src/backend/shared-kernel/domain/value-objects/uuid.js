import { ValidationError } from '../errors.js';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Uuid value object — wraps a validated UUID v4 string.
 * Equality is by value via `.equals()`; the wrapped string is exposed via `.toString()`.
 */
export class Uuid {
  /** @private */
  constructor(value) {
    this._value = value;
    Object.freeze(this);
  }

  /**
   * Validate and wrap an existing UUID string.
   * @param {string} value
   * @returns {Uuid}
   */
  static from(value) {
    if (typeof value !== 'string') {
      throw new ValidationError('Uuid.from requires a string', { received: typeof value });
    }
    if (!UUID_V4_RE.test(value)) {
      throw new ValidationError('Invalid UUID v4', { value });
    }
    return new Uuid(value.toLowerCase());
  }

  /**
   * Generate a fresh Uuid using an injected IdGenerator port.
   * @param {{ newId: () => string }} idGen
   * @returns {Uuid}
   */
  static generate(idGen) {
    if (!idGen || typeof idGen.newId !== 'function') {
      throw new ValidationError('Uuid.generate requires an IdGenerator with newId()');
    }
    return Uuid.from(idGen.newId());
  }

  /** Underlying canonical lowercase UUID string. */
  toString() {
    return this._value;
  }

  /** JSON serialisation as the bare string. */
  toJSON() {
    return this._value;
  }

  /** Value-equality check against another Uuid. */
  equals(other) {
    return other instanceof Uuid && other._value === this._value;
  }
}
