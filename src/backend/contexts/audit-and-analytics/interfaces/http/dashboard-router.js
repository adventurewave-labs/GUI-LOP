import express from 'express';

export function createDashboardRouter({ getActiveWorkflowsQuery }) {
  const router = express.Router();

  router.get('/dashboards/active-workflows', async (req, res, next) => {
    try {
      const items = await getActiveWorkflowsQuery.execute({
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
