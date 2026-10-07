// @ts-check
import express from 'express';
import { parsePaging } from './paging.js';

export function createAuditRouter({
  getWorkflowTrailQuery,
  getAuditTrailQuery,
  exportComplianceDataCommand,
  eventStore
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

  // Recomputes the hash chain. 200 + ok:true when intact; 409 when an entry
  // was changed, removed or reordered (so a monitor can alert on status
  // alone); 501 where there is no chain (in-memory mode).
  router.get('/audit/integrity', async (_req, res, next) => {
    try {
      const result = await eventStore.verifyChain();
      res.status(!result.supported ? 501 : result.ok ? 200 : 409).json(result);
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
      if (out.isFail()) {
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
    // Stores default to 1000 rows; never forward negative/huge values.
    ...parsePaging(q, { defaultLimit: 1000, maxLimit: 5000 }),
  };
}
