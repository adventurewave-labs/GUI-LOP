import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import { ValidationError } from '../../../../shared-kernel/domain/errors.js';

const SECRET_BYTES = 32;
const PREFIX = 'glop_';
// base64url alphabet check; lengths vary slightly (43 chars for 32 bytes).
const B64URL_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * ApiKeySecret value object. Wraps a 32-byte base64url-encoded secret.
 * Always prefixed with `glop_` so the auth middleware can distinguish API
 * keys from JWTs in `Authorization: Bearer ...`.
 *
 * The plaintext value is returned exactly once to the caller of
 * `ApiKey.mint()`. Only the SHA-256 hex digest is ever persisted.
 */
export class ApiKeySecret {
  /** @param {string} plaintext */
  constructor(plaintext) {
    if (typeof plaintext !== 'string') {
      throw new ValidationError('ApiKeySecret must be a string', 'apiKeySecret');
    }
    if (!plaintext.startsWith(PREFIX)) {
      throw new ValidationError(
        `ApiKeySecret must start with '${PREFIX}'`,
        'apiKeySecret',
      );
    }
    const tail = plaintext.slice(PREFIX.length);
    if (!B64URL_RE.test(tail)) {
      throw new ValidationError(
        'ApiKeySecret tail must be 43 base64url characters',
        'apiKeySecret',
      );
    }
    this.value = plaintext;
    Object.freeze(this);
  }

  /** Identification prefix on the raw token (e.g. for sniff routing). */
  static get prefix() {
    return PREFIX;
  }

  /**
   * Generate a fresh random secret. `idGen.randomBytes(n)` is used when
   * supplied (so tests can be deterministic); otherwise we fall back to
   * Node's crypto.randomBytes.
   * @param {{ randomBytes?: (n: number) => Buffer }} [idGen]
   */
  static generate(idGen) {
    const buf = idGen?.randomBytes
      ? idGen.randomBytes(SECRET_BYTES)
      : nodeRandomBytes(SECRET_BYTES);
    const tail = Buffer.from(buf).toString('base64url');
    return new ApiKeySecret(`${PREFIX}${tail}`);
  }

  /** True if the given raw header value looks like an API key (cheap sniff). */
  static looksLikeApiKey(raw) {
    return typeof raw === 'string' && raw.startsWith(PREFIX);
  }

  /** SHA-256 hex digest of the entire prefixed secret. */
  hash() {
    return createHash('sha256').update(this.value, 'utf8').digest('hex');
  }

  /** Stable hash of an arbitrary plaintext, without instantiating. */
  static hashOf(plaintext) {
    if (typeof plaintext !== 'string') return null;
    return createHash('sha256').update(plaintext, 'utf8').digest('hex');
  }

  toString() {
    return '[ApiKeySecret REDACTED]';
  }

  toJSON() {
    return '[ApiKeySecret REDACTED]';
  }

  equals(other) {
    return other instanceof ApiKeySecret && other.value === this.value;
  }
}
