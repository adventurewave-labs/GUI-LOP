import { GetWorkflowDetailQuery } from '../../application/queries/get-workflow-detail.js';
import { GetWorkflowTemplateQuery } from '../../application/queries/get-workflow-template.js';
import { ListActiveWorkflowsQuery } from '../../application/queries/list-active-workflows.js';
import { ListWorkflowTemplatesQuery } from '../../application/queries/list-workflow-templates.js';
import { CreateWorkflowUseCase } from '../../application/commands/create-workflow.js';
import { PublishWorkflowTemplateUseCase } from '../../application/commands/publish-workflow-template.js';
import { AlwaysAllowAuthorisationService } from '../../application/ports/authorisation-service.js';
import { InMemoryIdempotencyStore } from '../../application/ports/idempotency-store.js';
import { InMemoryWorkflowRepository } from '../../infrastructure/persistence/inmemory-workflow-repository.js';
import { InMemoryWorkflowTemplateRepository } from '../../infrastructure/persistence/inmemory-workflow-template-repository.js';
import { TemplateNotFoundError } from '../../domain/errors.js';
import { makeClock, makeIds } from '../helpers/test-fixtures.js';

async function setup() {
  const templates = new InMemoryWorkflowTemplateRepository();
  const workflows = new InMemoryWorkflowRepository();
  const clock = makeClock();
  const auth = new AlwaysAllowAuthorisationService();
  const idGen = makeIds('q');
  await new PublishWorkflowTemplateUseCase({ templates, clock, authorisation: auth }).execute({
    actor: { id: 'a' }, key: 'k1', name: 'K1',
    steps: [{ name: 'A', kind: 'automated' }],
  });
  const create = new CreateWorkflowUseCase({
    templates, workflows, clock, idGen, authorisation: auth,
    idempotency: new InMemoryIdempotencyStore(),
  });
  const { workflowId } = await create.execute({ actor: { id: 'u1' }, templateKey: 'k1' });
  return { templates, workflows, workflowId };
}

describe('queries', () => {
  it('lists templates', async () => {
    const { templates } = await setup();
    const q = new ListWorkflowTemplatesQuery({ templates });
    const out = await q.execute();
    expect(out).toHaveLength(1);
    expect(out[0].template_key).toBe('k1');
  });

  it('gets a single template', async () => {
    const { templates } = await setup();
    const q = new GetWorkflowTemplateQuery({ templates });
    const out = await q.execute({ key: 'k1' });
    expect(out.steps).toHaveLength(1);
  });

  it('errors on unknown template', async () => {
    const { templates } = await setup();
    const q = new GetWorkflowTemplateQuery({ templates });
    await expect(q.execute({ key: 'nope' })).rejects.toThrow(TemplateNotFoundError);
  });

  it('returns workflow detail', async () => {
    const { workflows, workflowId } = await setup();
    const q = new GetWorkflowDetailQuery({ workflows });
    const out = await q.execute({ workflowId });
    expect(out.id).toBe(workflowId);
    expect(out.metrics.total_steps).toBe(1);
  });

  it('lists active workflows via repository fallback', async () => {
    const { workflows } = await setup();
    const q = new ListActiveWorkflowsQuery({ workflows });
    const out = await q.execute({});
    expect(out).toHaveLength(1);
  });
});
