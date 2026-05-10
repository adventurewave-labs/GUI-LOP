/**
 * EligibilityRule value object.
 *
 * Encodes who can respond to a pending step. All fields are optional; absent
 * fields are treated as "no constraint of this kind". Combinations are AND-ed
 * (a user must satisfy every supplied constraint).
 *
 *   - requiredRole         : exact role name (e.g. "admin").
 *   - requiredPermissions  : permissions the user must possess (all of).
 *   - scope                : scope identifier the permissions apply to.
 */
import { InvariantViolationError } from '../errors.js';

export class EligibilityRule {
  /**
   * @param {object} args
   * @param {string} [args.requiredRole]
   * @param {string[]} [args.requiredPermissions]
   * @param {string} [args.scope]
   */
  constructor({ requiredRole, requiredPermissions, scope } = {}) {
    if (requiredRole !== undefined && (typeof requiredRole !== 'string' || !requiredRole)) {
      throw new InvariantViolationError('EligibilityRule.requiredRole must be a non-empty string');
    }
    if (requiredPermissions !== undefined) {
      if (!Array.isArray(requiredPermissions)) {
        throw new InvariantViolationError('EligibilityRule.requiredPermissions must be an array');
      }
      for (const p of requiredPermissions) {
        if (typeof p !== 'string' || !p) {
          throw new InvariantViolationError('EligibilityRule.requiredPermissions must contain non-empty strings');
        }
      }
    }
    if (scope !== undefined && scope !== null && typeof scope !== 'string') {
      throw new InvariantViolationError('EligibilityRule.scope must be a string');
    }
    this.requiredRole = requiredRole ?? null;
    this.requiredPermissions = Object.freeze(requiredPermissions ? [...requiredPermissions] : []);
    this.scope = scope ?? null;
    Object.freeze(this);
  }

  static of(args) {
    return new EligibilityRule(args ?? {});
  }

  toJSON() {
    return {
      requiredRole: this.requiredRole,
      requiredPermissions: [...this.requiredPermissions],
      scope: this.scope,
    };
  }
}
