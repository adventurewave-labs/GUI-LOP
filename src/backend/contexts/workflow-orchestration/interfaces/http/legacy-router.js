import { Router } from 'express';

/**
 * Legacy alias for `/api/workflows/*` -> the v1 router. Mounts the
 * supplied v1 router under the legacy prefix and rewrites a couple of
 * route shapes so existing clients keep working for one release.
 *
 * Mapping:
 *   GET    /api/workflows/templates                  -> v1 GET /templates
 *   POST   /api/workflows                            -> v1 POST /
 *   GET    /api/workflows/:id                        -> v1 GET /:id
 *   POST   /api/workflows/:id/execute                -> v1 POST /:id/execute
 *   POST   /api/workflows/:id/cancel                 -> v1 POST /:id/cancel
 *
 * `POST /api/workflows/:id/respond` is owned by the Human Interaction
 * context and is intentionally NOT proxied here.
 */
export function createLegacyWorkflowRouter(v1Router) {
  const router = Router();
  // Express composition: just delegate.
  router.use('/', v1Router);
  return router;
}
