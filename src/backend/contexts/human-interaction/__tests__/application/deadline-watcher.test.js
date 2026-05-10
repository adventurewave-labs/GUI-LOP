import { start } from '../../application/services/deadline-watcher.js';
import { EscalateOverdueStep } from '../../application/commands/escalate-overdue-step.js';
import { buildContext, seedPendingStep } from './helpers.js';

describe('Deadline watcher', () => {
  it('fires escalate for each overdue step on a manual tick (frozen clock)', async () => {
    const ctx = buildContext({ now: new Date('2026-05-10T11:00:00Z') });
    await seedPendingStep(ctx.pendingStepRepository, {
      workflowId: 'wf-1',
      stepId: 'a',
      deadline: new Date('2026-05-10T10:00:00Z'),
    });
    await seedPendingStep(ctx.pendingStepRepository, {
      workflowId: 'wf-1',
      stepId: 'b',
      deadline: new Date('2026-05-10T10:30:00Z'),
    });
    // not overdue
    await seedPendingStep(ctx.pendingStepRepository, {
      workflowId: 'wf-1',
      stepId: 'c',
      deadline: new Date('2026-05-10T12:00:00Z'),
    });

    const escalateUseCase = new EscalateOverdueStep({
      pendingStepRepository: ctx.pendingStepRepository,
      eventPublisher: ctx.eventPublisher,
      unitOfWork: ctx.unitOfWork,
      clock: ctx.clock,
    });

    // Use a long interval so the timer never fires; we drive ticks manually.
    const watcher = start({
      intervalMs: 60_000,
      escalateUseCase,
      pendingStepRepository: ctx.pendingStepRepository,
      clock: ctx.clock,
    });

    try {
      const result = await watcher.tick();
      expect(result.processed).toBe(2);
      const a = await ctx.pendingStepRepository.findByKey('wf-1', 'a');
      const b = await ctx.pendingStepRepository.findByKey('wf-1', 'b');
      const c = await ctx.pendingStepRepository.findByKey('wf-1', 'c');
      expect(a.escalationLevel).toBe(1);
      expect(b.escalationLevel).toBe(1);
      expect(c.escalationLevel).toBe(0);
    } finally {
      await watcher.stop();
    }
  });

  it('returns a stoppable handle and ignores ticks after stop', async () => {
    const ctx = buildContext({ now: new Date('2026-05-10T11:00:00Z') });
    await seedPendingStep(ctx.pendingStepRepository, {
      deadline: new Date('2026-05-10T10:00:00Z'),
    });
    const fakeUseCase = { execute: jest.fn(async () => {}) };
    const watcher = start({
      intervalMs: 60_000,
      escalateUseCase: fakeUseCase,
      pendingStepRepository: ctx.pendingStepRepository,
      clock: ctx.clock,
    });
    await watcher.stop();
    const result = await watcher.tick();
    expect(result.processed).toBe(0);
    expect(fakeUseCase.execute).not.toHaveBeenCalled();
  });

  it('reports errors to onError but keeps processing the batch', async () => {
    const ctx = buildContext({ now: new Date('2026-05-10T11:00:00Z') });
    await seedPendingStep(ctx.pendingStepRepository, { stepId: 'a', deadline: new Date('2026-05-10T10:00:00Z') });
    await seedPendingStep(ctx.pendingStepRepository, { stepId: 'b', deadline: new Date('2026-05-10T10:01:00Z') });

    const errors = [];
    const useCase = {
      calls: 0,
      async execute({ stepId }) {
        this.calls += 1;
        if (stepId === 'a') throw new Error('boom');
      },
    };

    const watcher = start({
      intervalMs: 60_000,
      escalateUseCase: useCase,
      pendingStepRepository: ctx.pendingStepRepository,
      clock: ctx.clock,
      onError: (err, ctx2) => errors.push({ err: err.message, ...ctx2 }),
    });
    try {
      const result = await watcher.tick();
      expect(useCase.calls).toBe(2);
      expect(result.processed).toBe(1); // 'b' succeeded
      expect(errors).toHaveLength(1);
      expect(errors[0].stepId).toBe('a');
    } finally {
      await watcher.stop();
    }
  });
});
