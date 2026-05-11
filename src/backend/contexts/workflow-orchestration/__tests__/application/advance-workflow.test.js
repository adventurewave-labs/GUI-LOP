/**
 * Unit tests for `AdvanceWorkflowUseCase`.
 *
 * Covers the iteration-3 fix where `execute({ workflowId, stepId, response })`
 * must apply the human response to the aggregate BEFORE re-running the
 * engine — otherwise workflows parked on `waiting_for_human` never make
 * progress again.
 */
import { AdvanceWorkflowUseCase } from '../../application/commands/advance-workflow.js';
import { CreateWorkflowUseCase } from '../../application/commands/create-workflow.js';
import { ExecuteWorkflowUseCase } from '../../application/commands/execute-workflow.js';
import { PublishWorkflowTemplateUseCase } from '../../application/commands/publish-workflow-template.js';
import { AlwaysAllowAuthorisationService } from '../../application/ports/authorisation-service.js';
import { InMemoryIdempotencyStore } from '../../application/ports/idempotency-store.js';
import { StubUIGenerationService } from '../../application/ports/ui-generation-service.js';
import { InMemoryWorkflowRepository } from '../../infrastructure/persistence/inmemory-workflow-repository.js';
import { InMemoryWorkflowTemplateRepository } from '../../infrastructure/persistence/inmemory-workflow-template-repository.js';
import { StubAutomatedStepRunner } from '../../infrastructure/step-runners/automated-step-runner.js';
import { StubExternalStepRunner } from '../../infrastructure/step-runners/external-step-runner.js';
import {
  StepNotFoundError,
  WorkflowConflictError,
  WorkflowNotFoundError,
} from '../../domain/errors.js';
import { makeClock, makeIds } from '../helpers/test-fixtures.js';

async function setup({ kind = 'human' } = {}) {
  const templates = new InMemoryWorkflowTemplateRepository();
  const workflows = new InMemoryWorkflowRepository();
  const clock = makeClock();
  const idGen = makeIds('adv');
  const auth = new AlwaysAllowAuthorisationService();
  const idempotency = new InMemoryIdempotencyStore();
  const publish = new PublishWorkflowTemplateUseCase({
    templates, clock, authorisation: auth,
  });
  if (kind === 'human') {
    await publish.execute({
      actor: { id: 'u' }, key: 'auto-then-human', name: 'Auto then Human',
      steps: [
        { name: 'Compute', kind: 'automated' },
        { name: 'Approve', kind: 'human', uiSpec: { form: 'approve' } },
      ],
    });
  } else {
    await publish.execute({
      actor: { id: 'u' }, key: 'auto-only', name: 'Auto Only',
      steps: [{ name: 'Step1', kind: 'automated' }],
    });
  }
  const create = new CreateWorkflowUseCase({
    templates, workflows, clock, idGen, authorisation: auth, idempotency,
  });
  const ui = new StubUIGenerationService();
  const exec = new ExecuteWorkflowUseCase({
    workflows,
    templates,
    clock,
    authorisation: auth,
    idempotency,
    automatedRunner: new StubAutomatedStepRunner(),
    externalRunner: new StubExternalStepRunner(),
    uiGeneration: ui,
  });
  const advance = new AdvanceWorkflowUseCase({
    workflows,
    templates,
    clock,
    automatedRunner: new StubAutomatedStepRunner(),
    externalRunner: new StubExternalStepRunner(),
    uiGeneration: ui,
  });
  return { templates, workflows, create, exec, advance, ui };
}

async function pauseOnHumanStep(ctx) {
  const created = await ctx.create.execute({
    actor: { id: 'u1' },
    templateKey: 'auto-then-human',
  });
  const out = await ctx.exec.execute({
    actor: { id: 'u1' },
    workflowId: created.workflowId,
  });
  expect(out.status).toBe('waiting_for_human');
  const wf = await ctx.workflows.findById(created.workflowId);
  const humanStep = wf.steps.find((s) => s.status === 'waiting_for_human');
  expect(humanStep).toBeDefined();
  return { workflowId: created.workflowId, stepId: humanStep.id };
}

describe('AdvanceWorkflowUseCase', () => {
  it('throws WorkflowNotFoundError for an unknown workflow', async () => {
    const ctx = await setup();
    await expect(
      ctx.advance.execute({ workflowId: 'nope', actor: { id: 'u' } }),
    ).rejects.toBeInstanceOf(WorkflowNotFoundError);
  });

  it('no-ops on a terminal workflow (returns already_terminal)', async () => {
    const ctx = await setup({ kind: 'auto' });
    const created = await ctx.create.execute({
      actor: { id: 'u1' }, templateKey: 'auto-only',
    });
    await ctx.exec.execute({
      actor: { id: 'u1' }, workflowId: created.workflowId,
    });
    const out = await ctx.advance.execute({
      actor: { id: 'u1' }, workflowId: created.workflowId,
    });
    expect(out.status).toBe('completed');
    expect(out.stoppedReason).toBe('already_terminal');
    expect(out.ranSteps).toBe(0);
  });

  describe('with { stepId, response } — human response branch', () => {
    it('applies the response and resumes the workflow to completed', async () => {
      const ctx = await setup();
      const { workflowId, stepId } = await pauseOnHumanStep(ctx);

      const out = await ctx.advance.execute({
        actor: { id: 'u1' },
        workflowId,
        stepId,
        response: { action: 'approve', payload: { ok: true } },
      });

      expect(out.status).toBe('completed');
      const wf = await ctx.workflows.findById(workflowId);
      expect(wf.status).toBe('completed');
      // The response was merged into the aggregate's context under the
      // step name (workflow.recordStepOutput does the merge).
      expect(wf.context.toJSON().Approve).toEqual({
        action: 'approve', payload: { ok: true },
      });
      // The step is now completed and carries the response as its output.
      const approve = wf.steps.find((s) => s.name === 'Approve');
      expect(approve.status).toBe('completed');
      expect(approve.outputData).toEqual({
        action: 'approve', payload: { ok: true },
      });
      // The aggregate emitted the full lifecycle, ending in workflow.completed.
      const types = ctx.workflows.publishedEvents.map((e) => e.eventType);
      expect(types).toEqual(expect.arrayContaining([
        'workflow_orchestration.workflow.created',
        'workflow_orchestration.workflow.started',
        'workflow_orchestration.workflow.human_input_required',
        'workflow_orchestration.workflow.step_completed',
        'workflow_orchestration.workflow.completed',
      ]));
    });

    it('throws StepNotFoundError when stepId does not match any step', async () => {
      const ctx = await setup();
      const { workflowId } = await pauseOnHumanStep(ctx);
      await expect(
        ctx.advance.execute({
          actor: { id: 'u1' },
          workflowId,
          stepId: 'no-such-step',
          response: { action: 'approve' },
        }),
      ).rejects.toBeInstanceOf(StepNotFoundError);
    });
  });

  describe('without { stepId, response } — external/scheduler branch', () => {
    it('re-runs the engine without mutating step state when no response is supplied', async () => {
      const ctx = await setup();
      const { workflowId } = await pauseOnHumanStep(ctx);

      // Re-advance with no stepId/response — the workflow is parked on
      // a human step so nextAction() reports `idle:waiting_for_human`
      // and the engine returns without ranSteps.
      const out = await ctx.advance.execute({
        actor: { id: 'u1' },
        workflowId,
      });
      expect(out.status).toBe('waiting_for_human');
      expect(out.stoppedReason).toBe('waiting_for_human');
      expect(out.ranSteps).toBe(0);
      // The aggregate is still parked on the human step.
      const wf = await ctx.workflows.findById(workflowId);
      const approve = wf.steps.find((s) => s.name === 'Approve');
      expect(approve.status).toBe('waiting_for_human');
    });
  });

  describe('optimistic concurrency', () => {
    it('rejects the loser of two concurrent advances with WorkflowConflictError', async () => {
      const ctx = await setup();
      const { workflowId, stepId } = await pauseOnHumanStep(ctx);

      // Two concurrent advances both load the same aggregate snapshot
      // (same version). The first to save wins; the second must fail
      // with the optimistic-concurrency error.
      const p1 = ctx.advance.execute({
        actor: { id: 'u1' },
        workflowId,
        stepId,
        response: { action: 'approve' },
      });
      const p2 = ctx.advance.execute({
        actor: { id: 'u2' },
        workflowId,
        stepId,
        response: { action: 'approve-again' },
      });
      const settled = await Promise.allSettled([p1, p2]);
      const fulfilled = settled.filter((r) => r.status === 'fulfilled');
      const rejected = settled.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(WorkflowConflictError);
    });
  });
});
