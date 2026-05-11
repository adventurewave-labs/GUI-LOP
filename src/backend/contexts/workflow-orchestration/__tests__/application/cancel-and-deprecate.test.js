import { CancelWorkflowUseCase } from '../../application/commands/cancel-workflow.js';
import { CreateWorkflowUseCase } from '../../application/commands/create-workflow.js';
import { DeprecateWorkflowTemplateUseCase } from '../../application/commands/deprecate-workflow-template.js';
import { PublishWorkflowTemplateUseCase } from '../../application/commands/publish-workflow-template.js';
import { AlwaysAllowAuthorisationService } from '../../application/ports/authorisation-service.js';
import { InMemoryIdempotencyStore } from '../../application/ports/idempotency-store.js';
import { InMemoryWorkflowRepository } from '../../infrastructure/persistence/inmemory-workflow-repository.js';
import { InMemoryWorkflowTemplateRepository } from '../../infrastructure/persistence/inmemory-workflow-template-repository.js';
import { makeClock, makeIds } from '../helpers/test-fixtures.js';
import { WorkflowNotFoundError, TemplateNotFoundError } from '../../domain/errors.js';

describe('CancelWorkflowUseCase', () => {
  it('cancels a created workflow and persists status', async () => {
    const templates = new InMemoryWorkflowTemplateRepository();
    const workflows = new InMemoryWorkflowRepository();
    const clock = makeClock();
    const auth = new AlwaysAllowAuthorisationService();
    const idGen = makeIds('c');
    await new PublishWorkflowTemplateUseCase({ templates, clock, authorisation: auth }).execute({
      actor: { id: 'a' }, key: 'kk', name: 'kk',
      steps: [{ name: 'S', kind: 'automated' }],
    });
    const create = new CreateWorkflowUseCase({
      templates, workflows, clock, idGen, authorisation: auth,
      idempotency: new InMemoryIdempotencyStore(),
    });
    const { workflowId } = await create.execute({ actor: { id: 'u1' }, templateKey: 'kk' });
    const cancel = new CancelWorkflowUseCase({ workflows, clock, authorisation: auth });
    const out = await cancel.execute({ actor: { id: 'u1' }, workflowId, reason: 'noop' });
    expect(out.status).toBe('cancelled');
  });

  it('errors on unknown workflow', async () => {
    const cancel = new CancelWorkflowUseCase({
      workflows: new InMemoryWorkflowRepository(),
      clock: makeClock(),
      authorisation: new AlwaysAllowAuthorisationService(),
    });
    await expect(cancel.execute({ actor: { id: 'u1' }, workflowId: 'nope' }))
      .rejects.toThrow(WorkflowNotFoundError);
  });
});

describe('DeprecateWorkflowTemplateUseCase', () => {
  it('deprecates a published template', async () => {
    const templates = new InMemoryWorkflowTemplateRepository();
    const clock = makeClock();
    const auth = new AlwaysAllowAuthorisationService();
    await new PublishWorkflowTemplateUseCase({ templates, clock, authorisation: auth }).execute({
      actor: { id: 'a' }, key: 'kk', name: 'kk',
      steps: [{ name: 'S', kind: 'automated' }],
    });
    const dep = new DeprecateWorkflowTemplateUseCase({ templates, clock, authorisation: auth });
    const out = await dep.execute({ actor: { id: 'a' }, key: 'kk', version: 1 });
    expect(out.status).toBe('deprecated');
  });

  it('errors on missing template', async () => {
    const templates = new InMemoryWorkflowTemplateRepository();
    const dep = new DeprecateWorkflowTemplateUseCase({
      templates,
      clock: makeClock(),
      authorisation: new AlwaysAllowAuthorisationService(),
    });
    await expect(dep.execute({ actor: { id: 'a' }, key: 'no', version: 1 }))
      .rejects.toThrow(TemplateNotFoundError);
  });
});
