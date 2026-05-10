/**
 * EscalationPolicyService — decides the next escalation level and the
 * widened eligibility rule for a pending step whose deadline has passed.
 *
 * Pure function: takes the current PendingStep and the current instant,
 * returns either `null` (no escalation — caller should apply the timeout
 * policy directly) or `{ level, eligibility, reason }`.
 *
 * The default ladder is:
 *   level 0 -> 1 : drop the requiredRole constraint, keep permissions+scope.
 *   level 1 -> 2 : drop requiredPermissions, keep scope.
 *   level 2 -> 3 : drop scope (system-wide visibility).
 *   level 3+     : no further escalation; return null.
 *
 * Callers may override by supplying a `ladder` array on construction.
 */
import { EligibilityRule } from '../pending-step/eligibility-rule.js';

export class EscalationPolicyService {
  constructor({ ladder } = {}) {
    this._ladder = Array.isArray(ladder) && ladder.length > 0
      ? ladder
      : EscalationPolicyService.defaultLadder();
  }

  static defaultLadder() {
    return [
      // From level 0 to level 1 — drop role.
      (rule) => EligibilityRule.of({
        requiredPermissions: [...rule.requiredPermissions],
        scope: rule.scope ?? undefined,
      }),
      // From level 1 to level 2 — drop permissions.
      (rule) => EligibilityRule.of({
        scope: rule.scope ?? undefined,
      }),
      // From level 2 to level 3 — drop scope.
      () => EligibilityRule.of({}),
    ];
  }

  /**
   * @param {import('../pending-step/pending-step.js').PendingStep} pendingStep
   * @param {Date} now
   * @returns {{level:number, eligibility: EligibilityRule, reason: string}|null}
   */
  next(pendingStep, now) {
    if (!pendingStep || pendingStep.isClosed()) return null;
    const current = pendingStep.escalationLevel ?? 0;
    if (current >= this._ladder.length) return null;
    const widened = this._ladder[current](pendingStep.eligibility, pendingStep, now);
    return {
      level: current + 1,
      eligibility: widened instanceof EligibilityRule ? widened : EligibilityRule.of(widened),
      reason: 'deadline_passed',
    };
  }
}
