// @ts-check
/**
 * ListPendingStepsForUser query — drives the inbox UI.
 *
 * Returns every open pending step the caller can act on: they may respond to
 * the workflow (`workflow:respond`, API-key ceiling honoured) and meet the
 * step's eligibility rule. Computed at read time (not cached) so a user whose
 * role changed sees the inbox change immediately.
 */
import { StepVisibility } from './step-visibility.js';

export class ListPendingStepsForUser {
  /**
   * @param {{ pendingStepRepository: any, userDirectory: any, workflowReader?: any, authorisation?: import('./step-visibility.js').Authorisation|null }} deps
   */
  constructor({ pendingStepRepository, userDirectory, workflowReader, authorisation }) {
    this.pendingStepRepository = pendingStepRepository;
    this.visibility = new StepVisibility({ userDirectory, workflowReader, authorisation });
  }

  /**
   * @param {{ userId?: string, actor?: import('./step-visibility.js').Actor, filter?: object }} args
   */
  async execute({ userId, actor, filter = {} }) {
    const who = actor ?? (userId ? { userId } : null);
    if (!who?.userId) return [];
    const view = await this.visibility.forActor(who);
    const candidates = await this.pendingStepRepository.list(filter);
    const visible = [];
    for (const step of candidates) {
      if (await view.canRespond(step)) visible.push(step);
    }
    return visible;
  }
}
