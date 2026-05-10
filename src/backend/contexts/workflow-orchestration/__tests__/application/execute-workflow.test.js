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
import { makeClock, makeIds } from '../helpers/test-fixtures.js';
import { WorkflowNotFoundError } from '../../domain/errors.js';

async function setup({ kind = 'auto' } = {}) {
  const templates = new InMemoryWorkflowTemplateRepository();
  const workflows = new InMemoryWorkflowRepository();
  const clock = makeClock();
  const idGen = makeIds('e');
  const auth = new AlwaysAllowAuthorisationService();
  const idempotency = new InMemoryIdempotencyStore();
  const publish = new PublishWorkflowTemplateUseCase({ templates, clock, authorisation: auth });
  if (kind === 'auto') {
    await publish.execute({
      actor: { id: 'u' }, key: 'auto', name: 'Auto',
      steps: [{ name: 'Step1', kind: 'automated' }, { name: 'Step2', kind: 'automated' }],
    });
  } else {
    await publish.execute({
      actor: { id: 'u' }, key: 'auto', name: 'Auto',
      steps: [
        { name: 'Step1', kind: 'automated' },
        { name: 'Approval', kind: 'human', uiSpec: { form: 'approve' } },
      ],
    });
  }
  const create = new CreateWorkflowUseCase({ templates, workflows, clock, idGen, authorisation: auth, idempotency });
  const created = await create.execute({ actor: { id: 'u1' }, templateKey: 'auto' });

  const ui = new StubUIGenerationService();
  const exec = new ExecuteWorkflowUseCase({
    workflows, templates, clock,
    authorisation: auth,
    idempotency,
    automatedRunner: new StubAutomatedStepRunner(),
    externalRunner: new StubExternalStepRunner(),
    uiGeneration: ui,
  });
  return { exec, workflows, created, ui };
}

describe('ExecuteWorkflowUseCase', () => {
  it('runs an automated workflow to completion', async () => {
    const { exec, workflows, created } = await setup();
    const out = await exec.execute({ actor: { id: 'u1' }, workflowId: created.workflowId });
    expect(out.status).toBe('completed');
    const wf = await workflows.findById(created.workflowId);
    expect(wf.status).toBe('completed');
    expect(wf.completedAt).toBeTruthy();
  });

  it('pauses on the human step and emits human_input_required', async () => {
    const { exec, workflows, created, ui } = await setup({ kind: 'human' });
    const out = await exec.execute({ actor: { id: 'u1' }, workflowId: created.workflowId });
    expect(out.status).toBe('waiting_for_human');
    expect(ui.calls).toHaveLength(1);
    const events = workflows.publishedEvents.map((e) => e.eventType);
    expect(events).toEqual(expect.arrayContaining([
      'workflow_orchestration.workflow.human_input_required',
    ]));
  });

  it('errors on unknown workflow', async () => {
    const { exec } = await setup();
    await expect(exec.execute({ actor: { id: 'u1' }, workflowId: 'unknown' }))
      .rejects.toThrow(WorkflowNotFoundError);
  });
});
