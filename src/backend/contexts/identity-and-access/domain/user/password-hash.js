import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
const HASH_BRAND = Symbol.for('identity-and-access.PasswordHash');

/**
 * PasswordHash — opaque VO. Cannot be constructed from plaintext.
 * Only `PasswordHasher.hash(plaintext) -> PasswordHash` may produce
 * one (the hasher uses `PasswordHash.fromTrustedHash`, which requires
 * the brand).
 */
export class PasswordHash {
  /**
   * @param {symbol} brand
   * @param {string} hash
   */
  constructor(brand, hash) {
    if (brand !== HASH_BRAND) {
      throw new ValidationError(
        'PasswordHash cannot be constructed directly; use PasswordHasher.hash()',
        'passwordHash',
      );
    }
    if (typeof hash !== 'string' || hash.length === 0) {
      throw new ValidationError('PasswordHash must wrap a non-empty string', 'passwordHash');
    }
    this.value = hash;
    Object.freeze(this);
  }

  /** Used by infrastructure adapters that already hold a hash string. */
  static fromTrustedHash(hash) {
    return new PasswordHash(HASH_BRAND, hash);
  }

  toString() {
    return '[PasswordHash REDACTED]';
  }

  toJSON() {
    return '[PasswordHash REDACTED]';
  }

  equals(other) {
    return other instanceof PasswordHash && other.value === this.value;
  }
}
