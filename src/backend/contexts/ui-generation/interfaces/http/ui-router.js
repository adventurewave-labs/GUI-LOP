/**
 * ui-router.js — Express router for UI Generation endpoints.
 */

import express from 'express';

export function createUIRouter({
  generateUIForStepCommand,
  getUIDocumentQuery,
  listUIComponentsQuery
}) {
  const router = express.Router();
  router.use(express.json());

  router.post('/ui/generate', async (req, res, next) => {
    try {
      const out = await generateUIForStepCommand.execute(req.body);
      if (out.isFail) {
        return res
          .status(out.error?.code === 'VALIDATION_ERROR' ? 400 : 500)
          .json({ error: out.error?.message, code: out.error?.code });
      }
      res.status(201).json(out.value.toJSON());
    } catch (err) {
      next(err);
    }
  });

  router.get('/ui/documents/:id', async (req, res, next) => {
    try {
      const doc = await getUIDocumentQuery.execute({ id: req.params.id });
      if (!doc) return res.status(404).json({ error: 'UI document not found' });
      res.json(doc.toJSON());
    } catch (err) {
      next(err);
    }
  });

  router.get('/ui/components', async (_req, res, next) => {
    try {
      const items = await listUIComponentsQuery.execute();
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
