/**
 * Event handler: closes any pending steps for a workflow that has been
 * cancelled (or has otherwise ended without recording a human response).
 */
export class OnWorkflowCancelled {
  /**
   * @param {object} deps
   * @param {import('../ports/pending-step-repository.js').PendingStepRepository} deps.pendingStepRepository
   * @param {import('../commands/close-abandoned-step.js').CloseAbandonedStep} deps.closeAbandonedStep
   */
  constructor({ pendingStepRepository, closeAbandonedStep }) {
    this.pendingStepRepository = pendingStepRepository;
    this.closeAbandonedStep = closeAbandonedStep;
  }

  async handle(event) {
    const payload = event?.payload ?? event ?? {};
    const workflowId = payload.workflow_id ?? payload.workflowId;
    if (!workflowId) return;

    const candidates = await this.pendingStepRepository.list({ workflowId, openOnly: true });
    for (const step of candidates) {
      if (step.workflowId !== workflowId) continue;
      if (step.isClosed()) continue;
      try {
        await this.closeAbandonedStep.execute({
          workflowId,
          stepId: step.stepId,
          policy: payload.policy ?? 'cancelled',
        });
      } catch (_err) {
        // Best-effort: keep closing the rest. The watcher will catch any miss.
      }
    }
  }
}
