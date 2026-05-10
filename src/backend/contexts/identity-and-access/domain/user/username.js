import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
const USERNAME_RE = /^[a-z0-9_-]+$/;
const MIN = 3;
const MAX = 100;

/**
 * Username value object: 3–100 chars, lowercase letters/digits/_/-.
 */
export class Username {
  /** @param {string} raw */
  constructor(raw) {
    if (typeof raw !== 'string') {
      throw new ValidationError('username must be a string', 'username');
    }
    const trimmed = raw.trim();
    if (trimmed.length < MIN || trimmed.length > MAX) {
      throw new ValidationError(
        `username must be between ${MIN} and ${MAX} characters`,
        'username',
      );
    }
    if (!USERNAME_RE.test(trimmed)) {
      throw new ValidationError(
        'username may only contain lowercase letters, digits, hyphen, underscore',
        'username',
      );
    }
    this.value = trimmed;
    Object.freeze(this);
  }

  toString() {
    return this.value;
  }

  equals(other) {
    return other instanceof Username && other.value === this.value;
  }
}
