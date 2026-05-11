/**
 * PendingStep aggregate (projection root).
 *
 * Modelled in the Human Interaction context as a projection updated from
 * Workflow Orchestration events. It exists primarily to drive the inbox UI
 * and the deadline watcher; it carries lightweight invariants:
 *
 *   - Once `closed_at` is set, the step never reopens.
 *   - `escalation_level` is monotonic — it can only increase.
 */
import { EligibilityRule } from './eligibility-rule.js';
import { TimeoutPolicy, POLICY_ESCALATE } from './timeout-policy.js';
import { HumanStepEscalated } from '../events.js';
import { InvariantViolationError } from '../errors.js';

export class PendingStep {
  constructor(props) {
    this.workflowId = props.workflowId;
    this.stepId = props.stepId;
    this.uiDocumentId = props.uiDocumentId ?? null;
    this.eligibility = props.eligibility;
    this.deadline = props.deadline ?? null;
    this.onTimeout = props.onTimeout;
    this.escalationLevel = props.escalationLevel ?? 0;
    this.openedAt = props.openedAt;
    this.closedAt = props.closedAt ?? null;
    this._pendingEvents = props.pendingEvents ? [...props.pendingEvents] : [];
    // PendingStep is mutable through aggregate methods; do not freeze.
  }

  /**
   * Open a brand-new pending step.
   * @param {object} args
   * @param {string} args.workflowId
   * @param {string} args.stepId
   * @param {string} [args.uiDocumentId]
   * @param {object|EligibilityRule} args.eligibility
   * @param {Date}  [args.deadline]
   * @param {string|TimeoutPolicy} [args.onTimeout]
   * @param {Date}  args.now
   */
  static open(args) {
    if (!args.workflowId) throw new InvariantViolationError('PendingStep.open: workflowId required');
    if (!args.stepId) throw new InvariantViolationError('PendingStep.open: stepId required');
    if (!(args.now instanceof Date)) {
      throw new InvariantViolationError('PendingStep.open: now must be a Date');
    }
    if (args.deadline !== undefined && args.deadline !== null && !(args.deadline instanceof Date)) {
      throw new InvariantViolationError('PendingStep.open: deadline must be a Date');
    }
    return new PendingStep({
      workflowId: args.workflowId,
      stepId: args.stepId,
      uiDocumentId: args.uiDocumentId ?? null,
      eligibility: args.eligibility instanceof EligibilityRule
        ? args.eligibility
        : EligibilityRule.of(args.eligibility ?? {}),
      deadline: args.deadline ?? null,
      onTimeout: args.onTimeout instanceof TimeoutPolicy
        ? args.onTimeout
        : TimeoutPolicy.of(args.onTimeout ?? POLICY_ESCALATE),
      escalationLevel: 0,
      openedAt: args.now,
      closedAt: null,
      pendingEvents: [],
    });
  }

  /**
   * Increase the escalation level. Caller supplies the new level (computed by
   * the EscalationPolicyService) and a policy decision. The new level must be
   * strictly greater than the current one; otherwise the call is rejected.
   *
   * Optionally accepts a new EligibilityRule when widening the audience.
   *
   * @param {Date}   now
   * @param {number} level
   * @param {object} [opts]
   * @param {EligibilityRule|object} [opts.eligibility]
   * @param {string} [opts.reason]
   */
  escalate(now, level, opts = {}) {
    if (!(now instanceof Date)) {
      throw new InvariantViolationError('PendingStep.escalate: now must be a Date');
    }
    if (this.closedAt) {
      throw new InvariantViolationError('PendingStep is closed; cannot escalate', {
        workflowId: this.workflowId,
        stepId: this.stepId,
      });
    }
    if (typeof level !== 'number' || !Number.isInteger(level) || level <= this.escalationLevel) {
      throw new InvariantViolationError(
        'PendingStep.escalate: level must be an integer greater than current',
        { current: this.escalationLevel, requested: level },
      );
    }
    this.escalationLevel = level;
    if (opts.eligibility) {
      this.eligibility = opts.eligibility instanceof EligibilityRule
        ? opts.eligibility
        : EligibilityRule.of(opts.eligibility);
    }
    this._pendingEvents.push(new HumanStepEscalated({
      workflowId: this.workflowId,
      stepId: this.stepId,
      level,
      reason: opts.reason ?? 'deadline_passed',
      occurredAt: now,
    }));
    return this;
  }

  /**
   * Close the pending step. Idempotent only when called with the same instant
   * — any *second* close attempt is rejected to surface logic errors.
   */
  close(now) {
    if (!(now instanceof Date)) {
      throw new InvariantViolationError('PendingStep.close: now must be a Date');
    }
    if (this.closedAt) {
      throw new InvariantViolationError('PendingStep is already closed', {
        workflowId: this.workflowId,
        stepId: this.stepId,
        closedAt: this.closedAt,
      });
    }
    this.closedAt = now;
    return this;
  }

  isClosed() {
    return this.closedAt !== null;
  }

  isOverdue(now) {
    if (this.closedAt) return false;
    if (!this.deadline) return false;
    return now.getTime() >= this.deadline.getTime();
  }

  pendingEvents() {
    return [...this._pendingEvents];
  }

  clearEvents() {
    this._pendingEvents = [];
  }

  static rehydrate(state) {
    return new PendingStep({
      workflowId: state.workflowId,
      stepId: state.stepId,
      uiDocumentId: state.uiDocumentId ?? null,
      eligibility: state.eligibility instanceof EligibilityRule
        ? state.eligibility
        : EligibilityRule.of(state.eligibility ?? {}),
      deadline: state.deadline
        ? (state.deadline instanceof Date ? state.deadline : new Date(state.deadline))
        : null,
      onTimeout: state.onTimeout instanceof TimeoutPolicy
        ? state.onTimeout
        : TimeoutPolicy.of(state.onTimeout ?? POLICY_ESCALATE),
      escalationLevel: state.escalationLevel ?? 0,
      openedAt: state.openedAt instanceof Date ? state.openedAt : new Date(state.openedAt),
      closedAt: state.closedAt
        ? (state.closedAt instanceof Date ? state.closedAt : new Date(state.closedAt))
        : null,
      pendingEvents: [],
    });
  }

  toState() {
    return {
      workflowId: this.workflowId,
      stepId: this.stepId,
      uiDocumentId: this.uiDocumentId,
      eligibility: this.eligibility.toJSON(),
      deadline: this.deadline,
      onTimeout: this.onTimeout.value,
      escalationLevel: this.escalationLevel,
      openedAt: this.openedAt,
      closedAt: this.closedAt,
    };
  }
}
