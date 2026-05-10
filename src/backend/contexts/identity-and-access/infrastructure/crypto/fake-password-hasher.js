import { createHash } from 'node:crypto';
import { PasswordHash } from '../../domain/user/password-hash.js';

/**
 * Deterministic, FAST password hasher for tests. NEVER use in prod.
 * Uses SHA-256 with a fixed pepper so equality checks are stable.
 */
export class FakePasswordHasher {
  constructor(pepper = 'test-pepper') {
    this.pepper = pepper;
  }

  async hash(plaintext) {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new Error('plaintext must be a non-empty string');
    }
    const digest = createHash('sha256')
      .update(`${this.pepper}|${plaintext}`)
      .digest('hex');
    return PasswordHash.fromTrustedHash(`fake$${digest}`);
  }

  async verify(plaintext, hash) {
    if (!(hash instanceof PasswordHash)) return false;
    if (typeof plaintext !== 'string' || plaintext.length === 0) return false;
    const expected = await this.hash(plaintext);
    return expected.value === hash.value;
  }
}
