/**
 * EscalateOverdueStep use case.
 *
 * Invoked by the deadline watcher (or explicitly by an admin). Loads the
 * pending step, asks the EscalationPolicyService for the next level, and
 * either escalates or applies the on-timeout policy.
 *
 *   - on_timeout = escalate : delegate to EscalationPolicyService.next.
 *     If a next level exists, escalate (emits human_step.escalated).
 *     If the ladder is exhausted, emit human_step.deadline_passed and
 *     close the step.
 *   - on_timeout = fail     : close the step and emit deadline_passed.
 *   - on_timeout = auto_approve : close the step (auto-approval is
 *     materialised by the application bootstrapping a synthetic response;
 *     in this minimal flow we just emit deadline_passed and let the caller
 *     wire auto-approval at the orchestration boundary).
 */
import { EscalationPolicyService } from '../../domain/services/escalation-policy-service.js';
import { HumanStepDeadlinePassed } from '../../domain/events.js';
import { StepNotPendingError } from '../../domain/errors.js';

export class EscalateOverdueStep {
  constructor({
    pendingStepRepository,
    eventPublisher,
    unitOfWork,
    clock,
    escalationPolicy,
  }) {
    this.pendingStepRepository = pendingStepRepository;
    this.eventPublisher = eventPublisher;
    this.unitOfWork = unitOfWork;
    this.clock = clock;
    this.escalationPolicy = escalationPolicy ?? new EscalationPolicyService();
  }

  /**
   * @param {{ workflowId: string, stepId: string }} cmd
   */
  async execute({ workflowId, stepId }) {
    const pendingStep = await this.pendingStepRepository.findByKey(workflowId, stepId);
    if (!pendingStep || pendingStep.isClosed()) {
      throw new StepNotPendingError('No open pending step', { workflowId, stepId });
    }

    const now = this.clock.now();

    if (pendingStep.onTimeout.isFail()) {
      pendingStep.close(now);
      const events = [new HumanStepDeadlinePassed({
        workflowId,
        stepId,
        policy: 'fail',
        occurredAt: now,
      })];
      await this._persist(pendingStep, events);
      return { outcome: 'failed', step: pendingStep };
    }

    if (pendingStep.onTimeout.isAutoApprove()) {
      pendingStep.close(now);
      const events = [new HumanStepDeadlinePassed({
        workflowId,
        stepId,
        policy: 'auto_approve',
        occurredAt: now,
      })];
      await this._persist(pendingStep, events);
      return { outcome: 'auto_approved', step: pendingStep };
    }

    // Default: escalate.
    const next = this.escalationPolicy.next(pendingStep, now);
    if (!next) {
      // Ladder exhausted; emit deadline_passed and close.
      pendingStep.close(now);
      const events = [new HumanStepDeadlinePassed({
        workflowId,
        stepId,
        policy: 'escalate_exhausted',
        occurredAt: now,
      })];
      await this._persist(pendingStep, events);
      return { outcome: 'exhausted', step: pendingStep };
    }

    pendingStep.escalate(now, next.level, {
      eligibility: next.eligibility,
      reason: next.reason,
    });
    await this._persist(pendingStep, pendingStep.pendingEvents());
    pendingStep.clearEvents();
    return { outcome: 'escalated', step: pendingStep, level: next.level };
  }

  async _persist(step, events) {
    const uow = await this.unitOfWork.start();
    try {
      await this.pendingStepRepository.upsert(step, uow);
      await this.eventPublisher.publish(events, uow);
      await uow.commit();
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}
