import { ValidationError } from '../../shared-kernel-stubs.js';

const TOKEN_RE = /^[a-z][a-z0-9_-]*$/i;

/**
 * Permission value object.
 * Format: `<resource>:<action>[@<scope>]`
 *   - resource: identifier (e.g. `workflow`, `template`, `user`)
 *   - action:   identifier (e.g. `read`, `create`, `respond`)
 *   - scope:    optional resource id; when present the permission is
 *               narrowed to that specific resource
 */
export class Permission {
  /** @param {string} raw */
  constructor(raw) {
    if (typeof raw !== 'string') {
      throw new ValidationError('permission must be a string', 'permission');
    }
    const trimmed = raw.trim();
    const atIdx = trimmed.indexOf('@');
    const head = atIdx === -1 ? trimmed : trimmed.slice(0, atIdx);
    const scope = atIdx === -1 ? null : trimmed.slice(atIdx + 1);

    const parts = head.split(':');
    if (parts.length !== 2) {
      throw new ValidationError(
        'permission must be `<resource>:<action>[@<scope>]`',
        'permission',
      );
    }
    const [resource, action] = parts;
    if (!TOKEN_RE.test(resource) || !TOKEN_RE.test(action)) {
      throw new ValidationError(
        'permission resource and action must be alphanumeric tokens',
        'permission',
      );
    }
    if (scope !== null && scope.length === 0) {
      throw new ValidationError('permission scope must be non-empty', 'permission');
    }

    this.resource = resource.toLowerCase();
    this.action = action.toLowerCase();
    this.scope = scope;
    this.value = scope == null
      ? `${this.resource}:${this.action}`
      : `${this.resource}:${this.action}@${scope}`;
    Object.freeze(this);
  }

  static of(resource, action, scope) {
    const tail = scope ? `@${scope}` : '';
    return new Permission(`${resource}:${action}${tail}`);
  }

  /** True if `this` covers `required` (same resource:action and same-or-broader scope). */
  covers(required) {
    if (!(required instanceof Permission)) {
      throw new ValidationError('required must be Permission', 'required');
    }
    if (this.resource !== required.resource) return false;
    if (this.action !== required.action) return false;
    // Unscoped grant covers any scope (including unscoped).
    if (this.scope == null) return true;
    // Scoped grant only covers the same scope.
    return this.scope === required.scope;
  }

  toString() {
    return this.value;
  }

  equals(other) {
    return other instanceof Permission && other.value === this.value;
  }
}
