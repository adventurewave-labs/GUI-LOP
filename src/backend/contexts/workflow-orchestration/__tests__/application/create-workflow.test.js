import { CreateWorkflowUseCase } from '../../application/commands/create-workflow.js';
import { PublishWorkflowTemplateUseCase } from '../../application/commands/publish-workflow-template.js';
import { InMemoryIdempotencyStore } from '../../application/ports/idempotency-store.js';
import { AlwaysAllowAuthorisationService } from '../../application/ports/authorisation-service.js';
import { InMemoryWorkflowRepository } from '../../infrastructure/persistence/inmemory-workflow-repository.js';
import { InMemoryWorkflowTemplateRepository } from '../../infrastructure/persistence/inmemory-workflow-template-repository.js';
import { makeClock, makeIds } from '../helpers/test-fixtures.js';
import { TemplateNotFoundError } from '../../domain/errors.js';

async function setup() {
  const templates = new InMemoryWorkflowTemplateRepository();
  const workflows = new InMemoryWorkflowRepository();
  const clock = makeClock();
  const idGen = makeIds('id');
  const auth = new AlwaysAllowAuthorisationService();
  const idempotency = new InMemoryIdempotencyStore();
  const publish = new PublishWorkflowTemplateUseCase({ templates, clock, authorisation: auth });
  await publish.execute({
    actor: { id: 'u' }, key: 'demo', name: 'Demo',
    steps: [{ name: 'Step1', kind: 'automated' }],
  });
  const create = new CreateWorkflowUseCase({
    templates, workflows, clock, idGen, authorisation: auth, idempotency,
  });
  return { templates, workflows, create, idempotency };
}

describe('CreateWorkflowUseCase', () => {
  it('creates a workflow from the current template version', async () => {
    const { create, workflows } = await setup();
    const out = await create.execute({
      actor: { id: 'u1' }, templateKey: 'demo', context: { foo: 1 },
    });
    expect(out.workflowId).toBeTruthy();
    const wf = await workflows.findById(out.workflowId);
    expect(wf.steps).toHaveLength(1);
    expect(wf.context.toJSON()).toEqual({ foo: 1 });
  });

  it('errors on unknown template', async () => {
    const { create } = await setup();
    await expect(create.execute({
      actor: { id: 'u1' }, templateKey: 'missing',
    })).rejects.toThrow(TemplateNotFoundError);
  });

  it('returns the same workflow for repeat idempotency keys', async () => {
    const { create } = await setup();
    const a = await create.execute({
      actor: { id: 'u1' }, templateKey: 'demo', idempotencyKey: 'k1',
    });
    const b = await create.execute({
      actor: { id: 'u1' }, templateKey: 'demo', idempotencyKey: 'k1',
    });
    expect(a.workflowId).toBe(b.workflowId);
  });
});
