// @ts-check
import express from 'express';
import { parsePaging } from './paging.js';

export function createAnalyticsRouter({
  getWorkflowAnalyticsQuery,
  getUserActivityQuery
}) {
  const router = express.Router();

  router.get('/analytics/workflows', async (req, res, next) => {
    try {
      const items = await getWorkflowAnalyticsQuery.execute({
        ...parsePaging(req.query),
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.get('/analytics/users/:id', async (req, res, next) => {
    try {
      const items = await getUserActivityQuery.execute({
        userId: req.params.id,
        ...parsePaging(req.query),
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
