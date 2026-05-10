import { createHash, randomBytes } from 'node:crypto';
import { ValidationError } from '../../shared-kernel-stubs.js';

const SECRET_BYTES = 32; // → 64 hex chars
const HEX_RE = /^[a-f0-9]{64}$/;

/**
 * RefreshTokenSecret value object.
 * Holds an opaque 64-char hex secret. Hash with `hash()` before storing.
 */
export class RefreshTokenSecret {
  /** @param {string} hex */
  constructor(hex) {
    if (typeof hex !== 'string' || !HEX_RE.test(hex)) {
      throw new ValidationError(
        'refresh token must be 64 hex characters',
        'refreshToken',
      );
    }
    this.value = hex;
    Object.freeze(this);
  }

  /**
   * Generate a fresh random secret.
   * `idGen.randomBytes(n)` is used when supplied (so tests can be
   * deterministic); otherwise we use crypto.randomBytes.
   * @param {{ randomBytes?: (n: number) => Buffer }} [idGen]
   */
  static generate(idGen) {
    const buf = idGen?.randomBytes
      ? idGen.randomBytes(SECRET_BYTES)
      : randomBytes(SECRET_BYTES);
    return new RefreshTokenSecret(buf.toString('hex'));
  }

  /** SHA-256 hex digest of the secret. */
  hash() {
    return createHash('sha256').update(this.value, 'utf8').digest('hex');
  }

  toString() {
    return '[RefreshTokenSecret REDACTED]';
  }

  toJSON() {
    return '[RefreshTokenSecret REDACTED]';
  }

  equals(other) {
    return other instanceof RefreshTokenSecret && other.value === this.value;
  }
}
