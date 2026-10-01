// @ts-check
/**
 * notification-router.js — Express router for notification & realtime endpoints.
 *
 * Mount with:
 *   app.use('/api/v1', createNotificationRouter({ ...deps }));
 */

import { webhookUrlProblem } from './webhook-url.js';
import express from 'express';

export function createNotificationRouter({
  listSubscriptionsQuery,
  unsubscribeCommand,
  registerWebhookCommand,
  listDeadLettersQuery,
  retryDeadLetterCommand,
  allowInsecureWebhooks = false
}) {
  const router = express.Router();
  router.use(express.json());

  // Subscriptions belong to the caller. `?ref=` used to be honoured for
  // everyone, so any user could list (and below, delete) anyone's
  // subscriptions, and register webhooks under someone else's name. Only
  // admins using a full (unscoped) credential may act for another subject.
  const isAdmin = (req) => req.user?.role === 'admin' && !req.user?.apiKeyPermissions;
  const subjectOf = (req, requested) => (isAdmin(req) && requested ? String(requested) : req.user?.id ?? null);

  // The query returns EVERY active subscription unless both kind and ref are
  // given, so ownership is enforced here rather than trusted to the filter.
  const refOf = (sub) => String(sub.subscriberRef ?? sub.toJSON?.().subscriberRef ?? '');
  const ownedSubscriptions = async (req, requestedRef, kind) => {
    const subject = subjectOf(req, requestedRef);
    const all = await listSubscriptionsQuery.execute({ subscriberKind: kind, subscriberRef: subject });
    if (isAdmin(req) && !requestedRef) return all;
    return all.filter((sub) => subject != null && refOf(sub) === String(subject));
  };

  router.get('/subscriptions', async (req, res, next) => {
    try {
      const subs = await ownedSubscriptions(req, req.query.ref, req.query.kind);
      res.json({ items: subs.map((s) => s.toJSON?.() ?? s) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/subscriptions/:id', async (req, res, next) => {
    try {
      if (!isAdmin(req)) {
        const mine = await ownedSubscriptions(req, null, undefined);
        const owns = mine.some((sub) => String(sub.id?.value ?? sub.id ?? sub.toJSON?.().id) === String(req.params.id));
        // 404 (not 403): do not confirm that someone else's subscription exists.
        if (!owns) return res.status(404).json({ error: 'Subscription not found', code: 'SUBSCRIPTION_NOT_FOUND' });
      }
      const out = await unsubscribeCommand.execute({ id: req.params.id });
      if (out.isFail()) {
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
      const unsafe = webhookUrlProblem(req.body.url, { allowInsecure: allowInsecureWebhooks });
      if (unsafe) return res.status(400).json({ error: unsafe, code: 'INVALID_WEBHOOK_URL' });
      const out = await registerWebhookCommand.execute({
        subscriberRef: subjectOf(req, req.body.subscriberRef),
        url: req.body.url,
        filter: req.body.filter
      });
      if (out.isFail()) {
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
      if (out.isFail()) {
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
