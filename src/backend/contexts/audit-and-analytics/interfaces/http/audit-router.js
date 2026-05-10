import express from 'express';

export function createAuditRouter({
  getWorkflowTrailQuery,
  getAuditTrailQuery,
  exportComplianceDataCommand
}) {
  const router = express.Router();
  router.use(express.json());

  router.get('/audit/workflows/:id', async (req, res, next) => {
    try {
      const trail = await getWorkflowTrailQuery.execute({
        workflowId: req.params.id,
        range: parseRange(req.query)
      });
      res.json(trail);
    } catch (err) {
      next(err);
    }
  });

  router.get('/audit/aggregates/:type/:id', async (req, res, next) => {
    try {
      const trail = await getAuditTrailQuery.execute({
        aggregateType: req.params.type,
        aggregateId: req.params.id,
        range: parseRange(req.query)
      });
      res.json(trail);
    } catch (err) {
      next(err);
    }
  });

  router.post('/audit/exports', async (req, res, next) => {
    try {
      const out = await exportComplianceDataCommand.execute({
        aggregateType: req.body.aggregateType,
        aggregateId: req.body.aggregateId,
        range: req.body.range
      });
      if (out.isFail) {
        return res.status(400).json({ error: out.error?.message });
      }
      res.status(201).json(out.value);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function parseRange(q) {
  return {
    from: q.from,
    to: q.to,
    limit: parseInt(q.limit, 10) || undefined,
    offset: parseInt(q.offset, 10) || undefined
  };
}
