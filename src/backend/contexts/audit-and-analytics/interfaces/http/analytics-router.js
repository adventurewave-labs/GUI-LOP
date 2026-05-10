import express from 'express';

export function createAnalyticsRouter({
  getWorkflowAnalyticsQuery,
  getUserActivityQuery
}) {
  const router = express.Router();

  router.get('/analytics/workflows', async (req, res, next) => {
    try {
      const items = await getWorkflowAnalyticsQuery.execute({
        limit: parseInt(req.query.limit, 10) || 100,
        offset: parseInt(req.query.offset, 10) || 0
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
        limit: parseInt(req.query.limit, 10) || 100,
        offset: parseInt(req.query.offset, 10) || 0
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
