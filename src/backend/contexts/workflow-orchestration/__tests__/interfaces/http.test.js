import express from 'express';
import request from 'supertest';
import { CancelWorkflowUseCase } from '../../application/commands/cancel-workflow.js';
import { CreateWorkflowUseCase } from '../../application/commands/create-workflow.js';
import { DeprecateWorkflowTemplateUseCase } from '../../application/commands/deprecate-workflow-template.js';
import { ExecuteWorkflowUseCase } from '../../application/commands/execute-workflow.js';
import { PublishWorkflowTemplateUseCase } from '../../application/commands/publish-workflow-template.js';
import { GetWorkflowDetailQuery } from '../../application/queries/get-workflow-detail.js';
import { GetWorkflowTemplateQuery } from '../../application/queries/get-workflow-template.js';
import { ListActiveWorkflowsQuery } from '../../application/queries/list-active-workflows.js';
import { ListWorkflowTemplatesQuery } from '../../application/queries/list-workflow-templates.js';
import { AlwaysAllowAuthorisationService } from '../../application/ports/authorisation-service.js';
import { InMemoryIdempotencyStore } from '../../application/ports/idempotency-store.js';
import { StubUIGenerationService } from '../../application/ports/ui-generation-service.js';
import { InMemoryWorkflowRepository } from '../../infrastructure/persistence/inmemory-workflow-repository.js';
import { InMemoryWorkflowTemplateRepository } from '../../infrastructure/persistence/inmemory-workflow-template-repository.js';
import { StubAutomatedStepRunner } from '../../infrastructure/step-runners/automated-step-runner.js';
import { StubExternalStepRunner } from '../../infrastructure/step-runners/external-step-runner.js';
import { createWorkflowRouter } from '../../interfaces/http/workflow-router.js';
import { createLegacyWorkflowRouter } from '../../interfaces/http/legacy-router.js';
import { makeClock, makeIds } from '../helpers/test-fixtures.js';

function buildApp() {
  const templates = new InMemoryWorkflowTemplateRepository();
  const workflows = new InMemoryWorkflowRepository();
  const clock = makeClock();
  const idGen = makeIds('h');
  const auth = new AlwaysAllowAuthorisationService();
  const idempotency = new InMemoryIdempotencyStore();

  const publishTemplate = new PublishWorkflowTemplateUseCase({ templates, clock, authorisation: auth });
  const deprecateTemplate = new DeprecateWorkflowTemplateUseCase({ templates, clock, authorisation: auth });
  const createWorkflow = new CreateWorkflowUseCase({ templates, workflows, clock, idGen, authorisation: auth, idempotency });
  const executeWorkflow = new ExecuteWorkflowUseCase({
    workflows, templates, clock, authorisation: auth, idempotency,
    automatedRunner: new StubAutomatedStepRunner(),
    externalRunner: new StubExternalStepRunner(),
    uiGeneration: new StubUIGenerationService(),
  });
  const cancelWorkflow = new CancelWorkflowUseCase({ workflows, clock, authorisation: auth });

  const router = createWorkflowRouter({
    publishTemplate,
    deprecateTemplate,
    createWorkflow,
    executeWorkflow,
    cancelWorkflow,
    listTemplates: new ListWorkflowTemplatesQuery({ templates }),
    getTemplate: new GetWorkflowTemplateQuery({ templates }),
    getDetail: new GetWorkflowDetailQuery({ workflows }),
    listActive: new ListActiveWorkflowsQuery({ workflows }),
    idempotencyStore: idempotency,
    getActor: () => ({ id: 'u-test', role: 'admin' }),
  });

  const app = express();
  app.use(express.json());
  app.use('/api/v1/workflows', router);
  app.use('/api/workflows', createLegacyWorkflowRouter(router));
  return { app, templates, workflows };
}

describe('workflow router', () => {
  it('publishes a template via POST /templates', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/v1/workflows/templates')
      .send({
        key: 'demo',
        name: 'Demo',
        steps: [{ name: 'A', kind: 'automated' }],
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('published');
  });

  it('lists templates via GET /templates', async () => {
    const { app } = buildApp();
    await request(app).post('/api/v1/workflows/templates').send({
      key: 'demo', name: 'Demo', steps: [{ name: 'A', kind: 'automated' }],
    });
    const res = await request(app).get('/api/v1/workflows/templates');
    expect(res.status).toBe(200);
    expect(res.body.data.templates).toHaveLength(1);
  });

  it('creates and executes a workflow end-to-end', async () => {
    const { app } = buildApp();
    await request(app).post('/api/v1/workflows/templates').send({
      key: 'demo', name: 'Demo', steps: [{ name: 'A', kind: 'automated' }],
    });
    const create = await request(app)
      .post('/api/v1/workflows')
      .send({ template: 'demo', context: { foo: 1 } });
    expect(create.status).toBe(201);
    const id = create.body.data.workflow_id;
    const exec = await request(app).post(`/api/v1/workflows/${id}/execute`).send({});
    expect(exec.status).toBe(200);
    expect(exec.body.data.status).toBe('completed');

    const detail = await request(app).get(`/api/v1/workflows/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.workflow.status).toBe('completed');
  });

  it('honours Idempotency-Key on POST /workflows', async () => {
    const { app } = buildApp();
    await request(app).post('/api/v1/workflows/templates').send({
      key: 'demo', name: 'Demo', steps: [{ name: 'A', kind: 'automated' }],
    });
    const a = await request(app)
      .post('/api/v1/workflows')
      .set('Idempotency-Key', 'k1')
      .send({ template: 'demo' });
    const b = await request(app)
      .post('/api/v1/workflows')
      .set('Idempotency-Key', 'k1')
      .send({ template: 'demo' });
    expect(a.status).toBe(201);
    expect(b.body.data.workflow_id).toBe(a.body.data.workflow_id);
  });

  it('returns 404 for unknown workflow detail', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/workflows/missing');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('cancels a workflow via POST /:id/cancel', async () => {
    const { app } = buildApp();
    await request(app).post('/api/v1/workflows/templates').send({
      key: 'demo', name: 'Demo', steps: [{ name: 'A', kind: 'automated' }],
    });
    const create = await request(app).post('/api/v1/workflows').send({ template: 'demo' });
    const id = create.body.data.workflow_id;
    const res = await request(app).post(`/api/v1/workflows/${id}/cancel`).send({ reason: 'never mind' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('legacy /api/workflows/templates routes to v1', async () => {
    const { app } = buildApp();
    await request(app).post('/api/v1/workflows/templates').send({
      key: 'demo', name: 'Demo', steps: [{ name: 'A', kind: 'automated' }],
    });
    const res = await request(app).get('/api/workflows/templates');
    expect(res.status).toBe(200);
    expect(res.body.data.templates).toHaveLength(1);
  });
});
