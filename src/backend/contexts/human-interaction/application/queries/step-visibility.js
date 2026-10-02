// @ts-check
/**
 * Who may see a pending human step.
 *
 * The inbox used to list every open step the caller passed the step's
 * eligibility rule for — and a step with no rule is "eligible" for everyone —
 * without asking whether the caller may respond at all. A `viewer` (read-only
 * role) therefore saw other people's pending steps in their inbox and could
 * open them, although answering returned 403.
 *
 * Rules (the same two checks RecordHumanResponse applies, in the same order):
 *   - responder:  holds `workflow:respond` for the workflow (API-key ceiling
 *                 honoured) AND meets the step's eligibility rule;
 *   - owner:      created the workflow (may look at, not necessarily answer,
 *                 the steps of their own workflow) — detail view only.
 */
import { EligibilityService } from '../../domain/services/eligibility-service.js';

/**
 * @typedef {{ userId: string, apiKeyPermissions?: string[]|null }} Actor
 * @typedef {{ authorise(q: { actor: Actor, permission: string, scope?: string }): Promise<{ authorised: boolean }> }} Authorisation
 */

export class StepVisibility {
  /**
   * @param {{ userDirectory: any, workflowReader?: any, authorisation?: Authorisation|null }} deps
   */
  constructor({ userDirectory, workflowReader, authorisation }) {
    this.userDirectory = userDirectory;
    this.workflowReader = workflowReader;
    this.authorisation = authorisation ?? null;
  }

  /**
   * A per-request view: the user snapshot and the per-workflow decisions are
   * loaded once, however many steps are checked.
   * @param {Actor} actor
   */
  async forActor(actor) {
    const snapshot = actor?.userId ? await this.userDirectory.getUser(actor.userId) : null;
    const user = snapshot && { ...snapshot, permissionCeiling: actor.apiKeyPermissions ?? null };
    /** @type {Map<string, Promise<{ mayRespond: boolean, workflow: any }>>} */
    const perWorkflow = new Map();
    const load = (workflowId) => {
      let entry = perWorkflow.get(workflowId);
      if (!entry) {
        entry = (async () => {
          const [auth, summary] = await Promise.all([
            this.authorisation
              ? this.authorisation.authorise({ actor, permission: 'workflow:respond', scope: workflowId })
              : { authorised: true },
            typeof this.workflowReader?.getSummary === 'function' ? this.workflowReader.getSummary(workflowId) : null,
          ]);
          return { mayRespond: Boolean(auth?.authorised), workflow: summary ?? { id: workflowId } };
        })();
        perWorkflow.set(workflowId, entry);
      }
      return entry;
    };

    return {
      /** @param {any} step */
      canRespond: async (step) => {
        if (!user || !step || step.isClosed()) return false;
        const { mayRespond, workflow } = await load(step.workflowId);
        return mayRespond && EligibilityService.eligibleFor(user, step, workflow);
      },
      /** @param {any} step */
      isOwner: async (step) => {
        if (!user || !step) return false;
        const { workflow } = await load(step.workflowId);
        const owner = workflow?.created_by ?? workflow?.createdBy ?? null;
        return owner != null && String(owner) === String(user.id);
      },
    };
  }
}
