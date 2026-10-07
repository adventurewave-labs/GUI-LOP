// @ts-check
/**
 * GetPendingStep query.
 *
 * With an `actor`, the step is returned only to someone who can respond to it
 * or who owns the workflow; everyone else gets `null` (the router answers 404,
 * so the existence of someone else's step is not confirmed). Without an actor
 * (internal callers) the step is returned as stored.
 */
import { StepVisibility } from './step-visibility.js';

export class GetPendingStep {
  /**
   * @param {{ pendingStepRepository: any, userDirectory?: any, workflowReader?: any, authorisation?: import('./step-visibility.js').Authorisation|null }} deps
   */
  constructor({ pendingStepRepository, userDirectory, workflowReader, authorisation }) {
    this.pendingStepRepository = pendingStepRepository;
    this.visibility = userDirectory ? new StepVisibility({ userDirectory, workflowReader, authorisation }) : null;
  }

  /**
   * @param {{ workflowId: string, stepId: string, actor?: import('./step-visibility.js').Actor }} args
   */
  async execute({ workflowId, stepId, actor }) {
    if (!workflowId || !stepId) return null;
    const step = await this.pendingStepRepository.findByKey(workflowId, stepId);
    if (!step || !actor) return step;
    if (!this.visibility || !actor.userId) return null;
    const view = await this.visibility.forActor(actor);
    return (await view.canRespond(step)) || (await view.isOwner(step)) ? step : null;
  }
}
