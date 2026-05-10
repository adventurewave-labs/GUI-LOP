/**
 * ListPendingStepsForUser query — drives the inbox UI.
 *
 * Returns every open pending step the supplied user is currently eligible
 * to respond to. Eligibility is computed at read time (not cached) so
 * a user whose role changed sees the inbox change immediately.
 */
import { EligibilityService } from '../../domain/services/eligibility-service.js';

export class ListPendingStepsForUser {
  constructor({ pendingStepRepository, userDirectory, workflowReader }) {
    this.pendingStepRepository = pendingStepRepository;
    this.userDirectory = userDirectory;
    this.workflowReader = workflowReader;
  }

  /**
   * @param {{ userId: string, filter?: object }} args
   */
  async execute({ userId, filter = {} }) {
    if (!userId) return [];
    const user = await this.userDirectory.getUser(userId);
    if (!user) return [];
    const candidates = await this.pendingStepRepository.list(filter);
    const eligible = [];
    for (const step of candidates) {
      if (step.isClosed()) continue;
      const workflow = this.workflowReader && typeof this.workflowReader.getSummary === 'function'
        ? await this.workflowReader.getSummary(step.workflowId)
        : { id: step.workflowId };
      if (EligibilityService.eligibleFor(user, step, workflow ?? { id: step.workflowId })) {
        eligible.push(step);
      }
    }
    return eligible;
  }
}
