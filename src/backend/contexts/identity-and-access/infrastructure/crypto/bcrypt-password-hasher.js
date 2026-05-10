import bcrypt from 'bcrypt';
import { PasswordHash } from '../../domain/user/password-hash.js';

const DEFAULT_ROUNDS = 12;

/**
 * Bcrypt-backed PasswordHasher.
 */
export class BcryptPasswordHasher {
  constructor({ rounds = DEFAULT_ROUNDS } = {}) {
    this.rounds = rounds;
  }

  /** @param {string} plaintext */
  async hash(plaintext) {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new Error('plaintext must be a non-empty string');
    }
    const digest = await bcrypt.hash(plaintext, this.rounds);
    return PasswordHash.fromTrustedHash(digest);
  }

  /**
   * @param {string} plaintext
   * @param {PasswordHash} hash
   */
  async verify(plaintext, hash) {
    if (!(hash instanceof PasswordHash)) {
      throw new Error('hash must be a PasswordHash VO');
    }
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      return false;
    }
    return bcrypt.compare(plaintext, hash.value);
  }
}
