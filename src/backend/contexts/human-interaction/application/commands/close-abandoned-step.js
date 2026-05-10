/**
 * CloseAbandonedStep use case.
 *
 * Triggered when a workflow is cancelled or fails while a step is still
 * pending. Closes the projection, emits a `human_step.deadline_passed`
 * event with the supplied policy ("cancelled" or "abandoned").
 *
 * Idempotent: closing an already-closed step is a no-op success.
 */
import { HumanStepDeadlinePassed } from '../../domain/events.js';

export class CloseAbandonedStep {
  constructor({ pendingStepRepository, eventPublisher, unitOfWork, clock }) {
    this.pendingStepRepository = pendingStepRepository;
    this.eventPublisher = eventPublisher;
    this.unitOfWork = unitOfWork;
    this.clock = clock;
  }

  /**
   * @param {{ workflowId: string, stepId: string, policy?: string }} cmd
   */
  async execute({ workflowId, stepId, policy = 'cancelled' }) {
    const step = await this.pendingStepRepository.findByKey(workflowId, stepId);
    if (!step) return { outcome: 'not_found' };
    if (step.isClosed()) return { outcome: 'already_closed', step };

    const now = this.clock.now();
    step.close(now);

    const uow = await this.unitOfWork.start();
    try {
      await this.pendingStepRepository.upsert(step, uow);
      await this.eventPublisher.publish([
        new HumanStepDeadlinePassed({
          workflowId,
          stepId,
          policy,
          occurredAt: now,
        }),
      ], uow);
      await uow.commit();
    } catch (err) {
      await uow.rollback();
      throw err;
    }
    return { outcome: 'closed', step };
  }
}
