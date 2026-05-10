/**
 * TimeoutPolicy value object — what to do when a pending step's deadline
 * passes. One of `fail`, `escalate`, `auto_approve`.
 */
import { InvariantViolationError } from '../errors.js';

export const POLICY_FAIL = 'fail';
export const POLICY_ESCALATE = 'escalate';
export const POLICY_AUTO_APPROVE = 'auto_approve';

const ALLOWED = Object.freeze([POLICY_FAIL, POLICY_ESCALATE, POLICY_AUTO_APPROVE]);

export class TimeoutPolicy {
  constructor(value) {
    if (typeof value !== 'string' || !ALLOWED.includes(value)) {
      throw new InvariantViolationError(
        `TimeoutPolicy must be one of ${ALLOWED.join(', ')}`,
        { value },
      );
    }
    this.value = value;
    Object.freeze(this);
  }

  static of(value) {
    return new TimeoutPolicy(value);
  }

  static allowed() {
    return [...ALLOWED];
  }

  isFail() { return this.value === POLICY_FAIL; }
  isEscalate() { return this.value === POLICY_ESCALATE; }
  isAutoApprove() { return this.value === POLICY_AUTO_APPROVE; }
}
