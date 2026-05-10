import { EscalateOverdueStep } from '../../application/commands/escalate-overdue-step.js';
import {
  HUMAN_STEP_ESCALATED,
  HUMAN_STEP_DEADLINE_PASSED,
} from '../../domain/events.js';
import { StepNotPendingError } from '../../domain/errors.js';
import { buildContext, seedPendingStep } from './helpers.js';

function makeUseCase(ctx) {
  return new EscalateOverdueStep({
    pendingStepRepository: ctx.pendingStepRepository,
    eventPublisher: ctx.eventPublisher,
    unitOfWork: ctx.unitOfWork,
    clock: ctx.clock,
  });
}

describe('EscalateOverdueStep use case', () => {
  it('escalates a step with on_timeout=escalate and emits human_step.escalated', async () => {
    const ctx = buildContext();
    await seedPendingStep(ctx.pendingStepRepository, {
      deadline: new Date('2026-05-10T09:00:00Z'),
    });
    const uc = makeUseCase(ctx);

    const result = await uc.execute({ workflowId: 'wf-1', stepId: 'step-1' });
    expect(result.outcome).toBe('escalated');
    expect(result.level).toBe(1);
    expect(ctx.eventPublisher.events.map((e) => e.eventType)).toEqual([HUMAN_STEP_ESCALATED]);
    const step = await ctx.pendingStepRepository.findByKey('wf-1', 'step-1');
    expect(step.escalationLevel).toBe(1);
    expect(step.isClosed()).toBe(false);
  });

  it('closes the step and emits human_step.deadline_passed for on_timeout=fail', async () => {
    const ctx = buildContext();
    await seedPendingStep(ctx.pendingStepRepository, { onTimeout: 'fail', deadline: new Date('2026-05-10T09:00:00Z') });
    const uc = makeUseCase(ctx);

    const result = await uc.execute({ workflowId: 'wf-1', stepId: 'step-1' });
    expect(result.outcome).toBe('failed');
    const step = await ctx.pendingStepRepository.findByKey('wf-1', 'step-1');
    expect(step.isClosed()).toBe(true);
    expect(ctx.eventPublisher.events[0].eventType).toBe(HUMAN_STEP_DEADLINE_PASSED);
    expect(ctx.eventPublisher.events[0].payload.policy).toBe('fail');
  });

  it('closes the step for on_timeout=auto_approve', async () => {
    const ctx = buildContext();
    await seedPendingStep(ctx.pendingStepRepository, { onTimeout: 'auto_approve', deadline: new Date('2026-05-10T09:00:00Z') });
    const uc = makeUseCase(ctx);

    const result = await uc.execute({ workflowId: 'wf-1', stepId: 'step-1' });
    expect(result.outcome).toBe('auto_approved');
    expect(ctx.eventPublisher.events[0].payload.policy).toBe('auto_approve');
  });

  it('rejects when step is unknown or already closed', async () => {
    const ctx = buildContext();
    const uc = makeUseCase(ctx);
    await expect(uc.execute({ workflowId: 'wf-x', stepId: 'step-x' })).rejects.toBeInstanceOf(StepNotPendingError);
  });

  it('exhausts the escalation ladder and finally emits deadline_passed', async () => {
    const ctx = buildContext();
    await seedPendingStep(ctx.pendingStepRepository, { deadline: new Date('2026-05-10T09:00:00Z') });
    const uc = makeUseCase(ctx);

    await uc.execute({ workflowId: 'wf-1', stepId: 'step-1' }); // -> level 1
    await uc.execute({ workflowId: 'wf-1', stepId: 'step-1' }); // -> level 2
    await uc.execute({ workflowId: 'wf-1', stepId: 'step-1' }); // -> level 3
    const finalResult = await uc.execute({ workflowId: 'wf-1', stepId: 'step-1' });
    expect(finalResult.outcome).toBe('exhausted');
    const types = ctx.eventPublisher.events.map((e) => e.eventType);
    expect(types).toEqual([
      HUMAN_STEP_ESCALATED,
      HUMAN_STEP_ESCALATED,
      HUMAN_STEP_ESCALATED,
      HUMAN_STEP_DEADLINE_PASSED,
    ]);
  });
});
