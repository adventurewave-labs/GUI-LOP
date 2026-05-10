import { Router } from 'express';
import { expressErrorBoundary } from './error-mapper.js';
import { withHttpIdempotency } from './idempotency.js';

/**
 * Build an Express router for the Workflow Orchestration HTTP API
 * (`/api/v1/workflows/*`). Use cases are injected so the router stays
 * thin and testable.
 *
 * `getActor(req)` lifts an authenticated principal off the request;
 * defaults to `req.user` (compatible with the existing auth middleware).
 */
export function createWorkflowRouter({
  publishTemplate,
  deprecateTemplate,
  createWorkflow,
  executeWorkflow,
  cancelWorkflow,
  listTemplates,
  getTemplate,
  getDetail,
  listActive,
  idempotencyStore,
  getActor = (req) => req.user ?? null,
}) {
  const router = Router();

  router.get('/templates', expressErrorBoundary(async (req, res) => {
    const out = await listTemplates.execute({
      activeOnly: req.query.active === 'true',
    });
    res.json({ success: true, data: { templates: out } });
  }));

  router.get('/templates/:key', expressErrorBoundary(async (req, res) => {
    const out = await getTemplate.execute({
      key: req.params.key,
      version: req.query.version ? Number(req.query.version) : undefined,
    });
    res.json({ success: true, data: { template: out } });
  }));

  router.post('/templates', expressErrorBoundary(async (req, res) => {
    const actor = getActor(req);
    const out = await publishTemplate.execute({
      actor,
      key: req.body.key ?? req.body.template_key,
      version: req.body.version,
      name: req.body.name,
      description: req.body.description,
      steps: req.body.steps ?? [],
      defaultConfig: req.body.default_config ?? req.body.defaultConfig,
      correlationId: req.header('X-Correlation-Id'),
    });
    res.status(201).json({ success: true, data: out });
  }));

  router.post('/templates/:key/deprecate', expressErrorBoundary(async (req, res) => {
    const actor = getActor(req);
    const version = Number(req.body.version ?? req.query.version);
    const out = await deprecateTemplate.execute({
      actor,
      key: req.params.key,
      version,
      correlationId: req.header('X-Correlation-Id'),
    });
    res.json({ success: true, data: out });
  }));

  router.get('/active', expressErrorBoundary(async (req, res) => {
    const out = await listActive.execute({
      byUser: req.query.user_id,
      byTemplate: req.query.template_key,
    });
    res.json({ success: true, data: { workflows: out } });
  }));

  router.post('/', expressErrorBoundary(withHttpIdempotency({
    store: idempotencyStore,
    route: 'POST /api/v1/workflows',
    handler: async (req, res) => {
      const actor = getActor(req);
      const out = await createWorkflow.execute({
        actor,
        templateKey: req.body.template ?? req.body.template_key,
        templateVersion: req.body.template_version,
        context: req.body.context ?? {},
        idempotencyKey: req.header('Idempotency-Key'),
        correlationId: req.header('X-Correlation-Id'),
      });
      res.status(201).json({
        success: true,
        message: 'Workflow created successfully',
        data: {
          workflow_id: out.workflowId,
          status: out.status,
          template_key: out.templateKey,
          template_version: out.templateVersion,
        },
      });
    },
  })));

  router.get('/:id', expressErrorBoundary(async (req, res) => {
    const out = await getDetail.execute({ workflowId: req.params.id });
    res.json({ success: true, data: { workflow: out } });
  }));

  router.post('/:id/execute', expressErrorBoundary(withHttpIdempotency({
    store: idempotencyStore,
    route: 'POST /api/v1/workflows/:id/execute',
    handler: async (req, res) => {
      const actor = getActor(req);
      const out = await executeWorkflow.execute({
        actor,
        workflowId: req.params.id,
        idempotencyKey: req.header('Idempotency-Key'),
        correlationId: req.header('X-Correlation-Id'),
      });
      res.json({
        success: true,
        data: {
          workflow_id: out.workflowId,
          status: out.status,
          stopped_reason: out.stoppedReason,
          ran_steps: out.ranSteps,
        },
      });
    },
  })));

  router.post('/:id/cancel', expressErrorBoundary(async (req, res) => {
    const actor = getActor(req);
    const out = await cancelWorkflow.execute({
      actor,
      workflowId: req.params.id,
      reason: req.body.reason,
      correlationId: req.header('X-Correlation-Id'),
    });
    res.json({ success: true, data: out });
  }));

  return router;
}
