import { ValidationError } from '../../../../shared-kernel/domain/errors.js';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LENGTH = 255;

/**
 * EmailAddress value object.
 * Lower-cased and validated at construction.
 */
export class EmailAddress {
  /** @param {string} raw */
  constructor(raw) {
    if (typeof raw !== 'string') {
      throw new ValidationError('email must be a string', 'email');
    }
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.length === 0) {
      throw new ValidationError('email must not be empty', 'email');
    }
    if (trimmed.length > MAX_LENGTH) {
      throw new ValidationError(
        `email must be at most ${MAX_LENGTH} characters`,
        'email',
      );
    }
    if (!EMAIL_RE.test(trimmed)) {
      throw new ValidationError('email format invalid', 'email');
    }
    this.value = trimmed;
    Object.freeze(this);
  }

  toString() {
    return this.value;
  }

  equals(other) {
    return other instanceof EmailAddress && other.value === this.value;
  }
}
