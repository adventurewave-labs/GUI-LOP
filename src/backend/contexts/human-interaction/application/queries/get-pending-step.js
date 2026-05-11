/**
 * GetPendingStep query.
 */
export class GetPendingStep {
  constructor({ pendingStepRepository }) {
    this.pendingStepRepository = pendingStepRepository;
  }

  async execute({ workflowId, stepId }) {
    if (!workflowId || !stepId) return null;
    return this.pendingStepRepository.findByKey(workflowId, stepId);
  }
}
