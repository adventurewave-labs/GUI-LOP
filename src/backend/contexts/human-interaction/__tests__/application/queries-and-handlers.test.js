import { ListPendingStepsForUser } from '../../application/queries/list-pending-steps-for-user.js';
import { GetPendingStep } from '../../application/queries/get-pending-step.js';
import { OnWorkflowHumanInputRequired } from '../../application/event-handlers/on-workflow-human-input-required.js';
import { buildContext, seedPendingStep } from './helpers.js';

describe('Queries', () => {
  it('lists only pending steps the user is eligible for', async () => {
    const ctx = buildContext({
      users: {
        'u-1': { id: 'u-1', role: 'reviewer', permissions: ['workflow:respond'], scopes: ['wf-1'] },
        'u-2': { id: 'u-2', role: 'viewer', permissions: [], scopes: [] },
      },
      workflows: { 'wf-1': { id: 'wf-1' } },
    });
    await seedPendingStep(ctx.pendingStepRepository, { workflowId: 'wf-1', stepId: 'a' });
    await seedPendingStep(ctx.pendingStepRepository, {
      workflowId: 'wf-1', stepId: 'b',
      eligibility: { requiredRole: 'admin' },
    });

    const q = new ListPendingStepsForUser({
      pendingStepRepository: ctx.pendingStepRepository,
      userDirectory: ctx.userDirectory,
      workflowReader: ctx.workflowReader,
    });

    const forU1 = await q.execute({ userId: 'u-1' });
    expect(forU1.map((s) => s.stepId)).toEqual(['a']);

    const forU2 = await q.execute({ userId: 'u-2' });
    expect(forU2).toEqual([]);
  });

  it('GetPendingStep returns null when not found', async () => {
    const ctx = buildContext();
    const q = new GetPendingStep({ pendingStepRepository: ctx.pendingStepRepository });
    expect(await q.execute({ workflowId: 'x', stepId: 'y' })).toBeNull();
  });
});

describe('OnWorkflowHumanInputRequired handler', () => {
  it('creates a pending step the first time', async () => {
    const ctx = buildContext();
    const handler = new OnWorkflowHumanInputRequired({
      pendingStepRepository: ctx.pendingStepRepository,
      unitOfWork: ctx.unitOfWork,
      clock: ctx.clock,
    });

    await handler.handle({
      payload: {
        workflow_id: 'wf-1',
        step_id: 'step-1',
        ui_document_id: 'ui-1',
        eligibility: { requiredRole: 'reviewer' },
        deadline: '2026-05-10T11:00:00Z',
        on_timeout: 'escalate',
      },
    });

    const stored = await ctx.pendingStepRepository.findByKey('wf-1', 'step-1');
    expect(stored).not.toBeNull();
    expect(stored.uiDocumentId).toBe('ui-1');
    expect(stored.eligibility.requiredRole).toBe('reviewer');
    expect(stored.deadline).toEqual(new Date('2026-05-10T11:00:00Z'));
  });

  it('does not reset escalation_level on a refresh', async () => {
    const ctx = buildContext();
    const seeded = await seedPendingStep(ctx.pendingStepRepository, { deadline: new Date('2026-05-10T09:00:00Z') });
    seeded.escalate(new Date('2026-05-10T10:30:00Z'), 1);
    await ctx.pendingStepRepository.upsert(seeded);

    const handler = new OnWorkflowHumanInputRequired({
      pendingStepRepository: ctx.pendingStepRepository,
      unitOfWork: ctx.unitOfWork,
      clock: ctx.clock,
    });

    await handler.handle({
      payload: {
        workflow_id: 'wf-1',
        step_id: 'step-1',
        eligibility: { requiredRole: 'admin' },
        deadline: '2026-05-10T12:00:00Z',
      },
    });

    const after = await ctx.pendingStepRepository.findByKey('wf-1', 'step-1');
    expect(after.escalationLevel).toBe(1);
    expect(after.eligibility.requiredRole).toBe('admin');
    expect(after.deadline).toEqual(new Date('2026-05-10T12:00:00Z'));
  });
});
