/**
 * ResponseAction value object.
 *
 * The platform recognises a small set of default actions: `approve`,
 * `reject`, `modify`. A workflow step's UI specification may extend this
 * set with template-defined actions (e.g. `request_changes`,
 * `delegate`). The action enforces case-insensitive equality and
 * provides a stable string form for persistence.
 */
import { InvalidResponseError } from '../errors.js';

export const DEFAULT_ACTIONS = Object.freeze(['approve', 'reject', 'modify']);

export class ResponseAction {
  /**
   * @param {string} value
   */
  constructor(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new InvalidResponseError('Action must be a non-empty string', { value });
    }
    this.value = value.trim().toLowerCase();
    Object.freeze(this);
  }

  /**
   * Build an action validating it against the union of default + extra actions.
   * @param {string} value
   * @param {string[]} [extraActions]
   */
  static of(value, extraActions = []) {
    const action = new ResponseAction(value);
    const allowed = ResponseAction.allowed(extraActions);
    if (!allowed.includes(action.value)) {
      throw new InvalidResponseError(
        `Action "${action.value}" is not one of the allowed actions`,
        { value: action.value, allowed },
      );
    }
    return action;
  }

  /** Combine defaults with extras; lowercased and de-duplicated. */
  static allowed(extraActions = []) {
    const set = new Set(DEFAULT_ACTIONS);
    for (const a of extraActions || []) {
      if (typeof a === 'string' && a.trim()) set.add(a.trim().toLowerCase());
    }
    return Array.from(set);
  }

  equals(other) {
    return other instanceof ResponseAction && other.value === this.value;
  }

  toString() {
    return this.value;
  }
}
