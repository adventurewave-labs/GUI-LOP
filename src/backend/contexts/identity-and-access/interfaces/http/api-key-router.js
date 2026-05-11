import { Router } from 'express';
import { sendError } from './error-mapper.js';

/**
 * Build the Express router for self-service API key management.
 *
 * Mounted under `/api/v1/auth/api-keys` (caller controls mount point).
 * All endpoints require an authenticated principal (JWT or API key).
 *
 * Required deps:
 *   useCases: {
 *     mintApiKey, listApiKeysForUser, revokeApiKey
 *   }
 *   requireAuth: middleware
 */
export function buildApiKeyRouter({ useCases, requireAuth } = {}) {
  if (!useCases) throw new Error('useCases required');
  if (typeof requireAuth !== 'function') {
    throw new Error('requireAuth middleware required');
  }
  const router = Router();
  router.use(requireAuth);

  // POST /  → mint a new key for the principal (or for another user when admin)
  router.post('/', async (req, res) => {
    try {
      const targetUserId = req.body?.userId ?? req.principal.userId;
      const out = await useCases.mintApiKey.execute({
        actorUserId: req.principal.userId,
        actorRole: req.principal.role,
        userId: targetUserId,
        name: req.body?.name,
        permissions: req.body?.permissions ?? [],
        expiresAt: req.body?.expiresAt ?? null,
      });
      res.status(201).json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  // GET / → list the principal's own keys (admins may pass ?userId=)
  router.get('/', async (req, res) => {
    try {
      const targetUserId = req.query?.userId ?? req.principal.userId;
      const out = await useCases.listApiKeysForUser.execute({
        actorUserId: req.principal.userId,
        actorRole: req.principal.role,
        userId: String(targetUserId),
      });
      res.status(200).json({ apiKeys: out });
    } catch (err) {
      sendError(res, err);
    }
  });

  // DELETE /:id → revoke a key
  router.delete('/:id', async (req, res) => {
    try {
      const out = await useCases.revokeApiKey.execute({
        actorUserId: req.principal.userId,
        actorRole: req.principal.role,
        apiKeyId: req.params.id,
      });
      res.status(200).json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
