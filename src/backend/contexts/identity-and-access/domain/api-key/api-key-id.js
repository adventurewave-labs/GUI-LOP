import { ValidationError } from '../../../../shared-kernel/domain/errors.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BRAND = Symbol.for('iam.ApiKeyId');

/**
 * Branded UUID value object for ApiKey identities. Constructing from the
 * outside requires the brand symbol so we can keep the constructor signature
 * symmetric while preventing accidental string-to-id coercion.
 */
export class ApiKeyId {
  /**
   * @param {symbol} brand
   * @param {string} value
   */
  constructor(brand, value) {
    if (brand !== BRAND) {
      throw new ValidationError(
        'ApiKeyId must be constructed via factory',
        'apiKeyId',
      );
    }
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      throw new ValidationError('ApiKeyId must be a UUID', 'apiKeyId');
    }
    this.value = value.toLowerCase();
    Object.freeze(this);
  }

  /** @param {string} value */
  static of(value) {
    return new ApiKeyId(BRAND, value);
  }

  /** @param {{ newId: () => string }} idGen */
  static generate(idGen) {
    if (!idGen || typeof idGen.newId !== 'function') {
      throw new ValidationError('idGen.newId required', 'idGen');
    }
    return new ApiKeyId(BRAND, idGen.newId());
  }

  toString() {
    return this.value;
  }

  toJSON() {
    return this.value;
  }

  /** @param {ApiKeyId} other */
  equals(other) {
    return other instanceof ApiKeyId && other.value === this.value;
  }
}
