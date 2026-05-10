/**
 * EligibilityService — pure function over loaded domain types.
 *
 * Determines whether a `user` (a snapshot supplied by the caller; we do
 * NOT load the User aggregate here) is eligible to respond to a given
 * `pendingStep`, given the surrounding `workflow` (used for scope).
 *
 * The user object is expected to expose:
 *   - id            : string
 *   - role          : string|null
 *   - permissions   : string[]
 *   - scopes        : string[]   (resource scopes the user is granted)
 *
 * The workflow object provides the scope key for permission matching:
 *   - id            : string
 *   - scope         : string|null   (defaults to workflow id)
 */
export class EligibilityService {
  /**
   * @param {object} user
   * @param {import('../pending-step/pending-step.js').PendingStep} pendingStep
   * @param {object} [workflow]
   * @returns {boolean}
   */
  static eligibleFor(user, pendingStep, workflow = {}) {
    if (!user || !pendingStep) return false;
    if (pendingStep.isClosed()) return false;

    const rule = pendingStep.eligibility;

    if (rule.requiredRole && user.role !== rule.requiredRole) {
      return false;
    }

    if (rule.requiredPermissions && rule.requiredPermissions.length > 0) {
      const userPerms = new Set(user.permissions || []);
      for (const required of rule.requiredPermissions) {
        if (!userPerms.has(required)) return false;
      }
    }

    if (rule.scope) {
      const expected = rule.scope;
      const userScopes = new Set(user.scopes || []);
      const workflowScope = workflow.scope ?? workflow.id ?? null;
      // The user must hold the rule's scope, OR the rule's scope must match
      // the workflow scope and the user must hold THAT scope.
      if (!userScopes.has(expected) && !(workflowScope === expected && userScopes.has(workflowScope))) {
        return false;
      }
    }

    return true;
  }

  // Instance method form for DI symmetry with other services.
  eligibleFor(user, pendingStep, workflow) {
    return EligibilityService.eligibleFor(user, pendingStep, workflow);
  }
}
