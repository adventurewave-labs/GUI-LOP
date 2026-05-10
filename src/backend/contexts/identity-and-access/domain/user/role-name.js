import { ValidationError } from '../../shared-kernel-stubs.js';

export const ROLE_NAMES = Object.freeze(new Set(['admin', 'user', 'viewer']));

/**
 * RoleName value object — frozen set of system roles.
 */
export class RoleName {
  /** @param {string} raw */
  constructor(raw) {
    if (typeof raw !== 'string') {
      throw new ValidationError('role must be a string', 'role');
    }
    const lower = raw.trim().toLowerCase();
    if (!ROLE_NAMES.has(lower)) {
      throw new ValidationError(
        `role must be one of ${[...ROLE_NAMES].join(', ')}`,
        'role',
      );
    }
    this.value = lower;
    Object.freeze(this);
  }

  static admin() {
    return new RoleName('admin');
  }

  static user() {
    return new RoleName('user');
  }

  static viewer() {
    return new RoleName('viewer');
  }

  toString() {
    return this.value;
  }

  equals(other) {
    return other instanceof RoleName && other.value === this.value;
  }
}
