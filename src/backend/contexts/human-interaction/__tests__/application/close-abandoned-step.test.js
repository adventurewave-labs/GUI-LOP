import { CloseAbandonedStep } from '../../application/commands/close-abandoned-step.js';
import { OnWorkflowCancelled } from '../../application/event-handlers/on-workflow-cancelled.js';
import { HUMAN_STEP_DEADLINE_PASSED } from '../../domain/events.js';
import { buildContext, seedPendingStep } from './helpers.js';

describe('CloseAbandonedStep + OnWorkflowCancelled', () => {
  it('closes a pending step on workflow cancellation', async () => {
    const ctx = buildContext();
    await seedPendingStep(ctx.pendingStepRepository, { workflowId: 'wf-z', stepId: 'step-1' });
    await seedPendingStep(ctx.pendingStepRepository, { workflowId: 'wf-z', stepId: 'step-2' });

    const closeUc = new CloseAbandonedStep({
      pendingStepRepository: ctx.pendingStepRepository,
      eventPublisher: ctx.eventPublisher,
      unitOfWork: ctx.unitOfWork,
      clock: ctx.clock,
    });
    const handler = new OnWorkflowCancelled({
      pendingStepRepository: ctx.pendingStepRepository,
      closeAbandonedStep: closeUc,
    });

    await handler.handle({ payload: { workflow_id: 'wf-z', policy: 'cancelled' } });

    const all = await ctx.pendingStepRepository.list({ workflowId: 'wf-z' });
    expect(all.every((s) => s.isClosed())).toBe(true);
    const events = ctx.eventPublisher.events.filter((e) => e.eventType === HUMAN_STEP_DEADLINE_PASSED);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.payload.policy === 'cancelled')).toBe(true);
  });

  it('returns not_found for unknown step', async () => {
    const ctx = buildContext();
    const closeUc = new CloseAbandonedStep({
      pendingStepRepository: ctx.pendingStepRepository,
      eventPublisher: ctx.eventPublisher,
      unitOfWork: ctx.unitOfWork,
      clock: ctx.clock,
    });
    const result = await closeUc.execute({ workflowId: 'nope', stepId: 'nope' });
    expect(result.outcome).toBe('not_found');
  });

  it('is idempotent on already-closed steps', async () => {
    const ctx = buildContext();
    await seedPendingStep(ctx.pendingStepRepository, { workflowId: 'wf-1', stepId: 'step-1' });
    const closeUc = new CloseAbandonedStep({
      pendingStepRepository: ctx.pendingStepRepository,
      eventPublisher: ctx.eventPublisher,
      unitOfWork: ctx.unitOfWork,
      clock: ctx.clock,
    });
    await closeUc.execute({ workflowId: 'wf-1', stepId: 'step-1' });
    const second = await closeUc.execute({ workflowId: 'wf-1', stepId: 'step-1' });
    expect(second.outcome).toBe('already_closed');
  });
});
