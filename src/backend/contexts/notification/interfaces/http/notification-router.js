/**
 * notification-router.js — Express router for notification & realtime endpoints.
 *
 * Mount with:
 *   app.use('/api/v1', createNotificationRouter({ ...deps }));
 */

import express from 'express';

export function createNotificationRouter({
  listSubscriptionsQuery,
  unsubscribeCommand,
  registerWebhookCommand,
  listDeadLettersQuery,
  retryDeadLetterCommand
}) {
  const router = express.Router();
  router.use(express.json());

  router.get('/subscriptions', async (req, res, next) => {
    try {
      const principal = req.user ?? null;
      const subs = await listSubscriptionsQuery.execute({
        subscriberKind: req.query.kind,
        subscriberRef: req.query.ref ?? principal?.id ?? null
      });
      res.json({ items: subs.map((s) => s.toJSON?.() ?? s) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/subscriptions/:id', async (req, res, next) => {
    try {
      const out = await unsubscribeCommand.execute({ id: req.params.id });
      if (out.isFail) {
        return res
          .status(out.error?.code === 'SUBSCRIPTION_NOT_FOUND' ? 404 : 400)
          .json({ error: out.error?.message, code: out.error?.code });
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/webhooks', async (req, res, next) => {
    try {
      const principal = req.user ?? null;
      const out = await registerWebhookCommand.execute({
        subscriberRef: req.body.subscriberRef ?? principal?.id ?? 'anonymous',
        url: req.body.url,
        filter: req.body.filter
      });
      if (out.isFail) {
        return res
          .status(400)
          .json({ error: out.error?.message, code: out.error?.code });
      }
      res.status(201).json(out.value.toJSON());
    } catch (err) {
      next(err);
    }
  });

  router.get('/dead-letters', async (req, res, next) => {
    try {
      const items = await listDeadLettersQuery.execute({
        limit: parseInt(req.query.limit, 10) || 100,
        offset: parseInt(req.query.offset, 10) || 0
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.post('/dead-letters/:id/retry', async (req, res, next) => {
    try {
      const out = await retryDeadLetterCommand.execute({ id: req.params.id });
      if (out.isFail) {
        return res
          .status(out.error?.code === 'DEAD_LETTER_NOT_FOUND' ? 404 : 400)
          .json({ error: out.error?.message, code: out.error?.code });
      }
      res.json(out.value);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
