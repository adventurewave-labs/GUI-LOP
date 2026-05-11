/**
 * HTTP router for the Human Interaction bounded context.
 *
 * The router declares paths RELATIVE to its mount point so the composition
 * root can mount it under `/api/v1` without producing the doubled prefix
 * `/api/v1/api/v1/...`. The bootstrap mounts this router at `/api/v1`, so
 * the effective routes are:
 *
 *   POST /api/v1/workflows/:id/respond     -> RecordHumanResponse
 *   GET  /api/v1/inbox                     -> ListPendingStepsForUser
 *   GET  /api/v1/inbox/:workflowId/:stepId -> GetPendingStep
 *
 * The composition root supplies the use cases and an `auth` middleware
 * that attaches `req.actor = { userId, sessionId }` (the bootstrap auth
 * middleware also pre-populates this from `req.principal`).
 */
import { Router } from 'express';
import { mapError } from './error-mapper.js';

/**
 * @param {object} deps
 * @param {object} deps.recordHumanResponse
 * @param {object} deps.listPendingStepsForUser
 * @param {object} deps.getPendingStep
 * @param {(req,res,next)=>void} [deps.auth]
 * @param {(req,res,next)=>void} [deps.requireIdempotencyKey]
 */
export function createHumanInteractionRouter(deps) {
  const router = Router();
  const auth = deps.auth ?? ((req, _res, next) => next());

  const requireIdempotencyKey = deps.requireIdempotencyKey ?? ((req, res, next) => {
    const key = req.get('Idempotency-Key') ?? req.headers['idempotency-key'];
    if (!key) {
      return res.status(400).json({
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'The Idempotency-Key header is required',
        },
      });
    }
    req.idempotencyKey = key;
    next();
  });

  router.post(
    '/workflows/:id/respond',
    auth,
    requireIdempotencyKey,
    async (req, res) => {
      try {
        const result = await deps.recordHumanResponse.execute({
          workflowId: req.params.id,
          stepId: req.body?.step_id ?? req.body?.stepId,
          action: req.body?.action,
          payload: req.body?.payload ?? {},
          rationale: req.body?.rationale,
          confidence: req.body?.confidence,
          actor: req.actor ?? { userId: req.user?.id, sessionId: req.session?.id },
          idempotencyKey: req.idempotencyKey,
        });
        res
          .status(result.deduplicated ? 200 : 201)
          .json({
            data: serialiseResponse(result.response),
            deduplicated: !!result.deduplicated,
          });
      } catch (err) {
        const { status, body } = mapError(err);
        res.status(status).json(body);
      }
    },
  );

  router.get('/inbox', auth, async (req, res) => {
    try {
      const userId = req.actor?.userId ?? req.user?.id;
      const steps = await deps.listPendingStepsForUser.execute({ userId, filter: { openOnly: true } });
      res.json({ data: steps.map(serialiseStep) });
    } catch (err) {
      const { status, body } = mapError(err);
      res.status(status).json(body);
    }
  });

  router.get('/inbox/:workflowId/:stepId', auth, async (req, res) => {
    try {
      const step = await deps.getPendingStep.execute({
        workflowId: req.params.workflowId,
        stepId: req.params.stepId,
      });
      if (!step) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pending step not found' } });
      }
      res.json({ data: serialiseStep(step) });
    } catch (err) {
      const { status, body } = mapError(err);
      res.status(status).json(body);
    }
  });

  return router;
}

function serialiseResponse(response) {
  if (!response) return null;
  if (typeof response.toState === 'function') return response.toState();
  return response;
}

function serialiseStep(step) {
  if (!step) return null;
  if (typeof step.toState === 'function') return step.toState();
  return step;
}
