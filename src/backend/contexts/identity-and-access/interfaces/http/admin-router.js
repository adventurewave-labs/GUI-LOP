import { Router } from 'express';
import { sendError } from './error-mapper.js';
import { adminGuard } from './admin-guard.js';

/**
 * Build the Express router for admin operations.
 *
 * Mounted under `/api/v1/admin`. All endpoints require an authenticated
 * principal AND `principal.role === 'admin'`.
 *
 * Required deps:
 *   useCases: {
 *     listUsers,            // query
 *     getUserProfile,       // existing query
 *     grantPermission,      // existing command
 *     revokePermission,     // existing command
 *     deactivateUser,       // command
 *     reactivateUser,       // command
 *   }
 *   requireAuth: middleware (already authenticates principal)
 */
export function buildAdminRouter({ useCases, requireAuth } = {}) {
  if (!useCases) throw new Error('useCases required');
  if (typeof requireAuth !== 'function') {
    throw new Error('requireAuth middleware required');
  }
  const router = Router();
  router.use(requireAuth);
  router.use(adminGuard);

  // GET /users — paginated list
  router.get('/users', async (req, res) => {
    try {
      const limit = req.query?.limit ? parseInt(req.query.limit, 10) : undefined;
      const offset = req.query?.offset
        ? parseInt(req.query.offset, 10)
        : undefined;
      const out = await useCases.listUsers.execute({ limit, offset });
      res.status(200).json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  // GET /users/:id — admin-flavoured profile (uses the existing query)
  router.get('/users/:id', async (req, res) => {
    try {
      const profile = await useCases.getUserProfile.execute({
        userId: req.params.id,
      });
      res.status(200).json(profile);
    } catch (err) {
      sendError(res, err);
    }
  });

  // POST /users/:id/permissions — grant
  router.post('/users/:id/permissions', async (req, res) => {
    try {
      const out = await useCases.grantPermission.execute({
        actorRole: req.principal.role,
        userId: req.params.id,
        permission: req.body?.permission,
        scope: req.body?.scope ?? undefined,
      });
      res.status(201).json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  // DELETE /users/:id/permissions/:permission — revoke
  router.delete('/users/:id/permissions/:permission', async (req, res) => {
    try {
      const out = await useCases.revokePermission.execute({
        actorRole: req.principal.role,
        userId: req.params.id,
        permission: req.params.permission,
        scope: req.query?.scope ?? undefined,
      });
      res.status(200).json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  // POST /users/:id/deactivate
  router.post('/users/:id/deactivate', async (req, res) => {
    try {
      const out = await useCases.deactivateUser.execute({
        actorRole: req.principal.role,
        userId: req.params.id,
      });
      res.status(200).json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  // POST /users/:id/reactivate
  router.post('/users/:id/reactivate', async (req, res) => {
    try {
      const out = await useCases.reactivateUser.execute({
        actorRole: req.principal.role,
        userId: req.params.id,
      });
      res.status(200).json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
