/**
 * UI Generation context — API smoke tests.
 */

import express from 'express';
import request from 'supertest';

import { createUIRouter } from '../../../../src/backend/contexts/ui-generation/interfaces/http/ui-router.js';
import { GenerateUIForStepCommand } from '../../../../src/backend/contexts/ui-generation/application/commands/generate-ui-for-step.js';
import { GetUIDocumentQuery } from '../../../../src/backend/contexts/ui-generation/application/queries/get-ui-document.js';
import { ListUIComponentsQuery } from '../../../../src/backend/contexts/ui-generation/application/queries/list-ui-components.js';

import { InMemoryUIDocumentRepository } from '../../../../src/backend/contexts/ui-generation/infrastructure/persistence/inmemory-ui-document-repository.js';
import { InMemoryComponentCatalogueRepository } from '../../../../src/backend/contexts/ui-generation/infrastructure/persistence/inmemory-component-catalogue-repository.js';
import { InMemoryStorage } from '../../../../src/backend/contexts/ui-generation/infrastructure/storage/inmemory-storage.js';

function buildApp() {
  const docs = new InMemoryUIDocumentRepository();
  const catalogue = new InMemoryComponentCatalogueRepository();
  const storage = new InMemoryStorage();

  const cmd = new GenerateUIForStepCommand({
    uiDocumentRepository: docs,
    componentCatalogueRepository: catalogue,
    objectStorage: storage
  });

  const app = express();
  app.use('/api/v1', createUIRouter({
    generateUIForStepCommand: cmd,
    getUIDocumentQuery: new GetUIDocumentQuery({ uiDocumentRepository: docs }),
    listUIComponentsQuery: new ListUIComponentsQuery({ componentCatalogueRepository: catalogue })
  }));

  return { app, docs };
}

describe('ui-router', () => {
  it('POST /ui/generate creates a document', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/v1/ui/generate')
      .send({
        workflowId: 'wf-1',
        stepId: 'step-1',
        fields: [{ id: 'name', label: 'Name', type: 'text' }]
      });
    expect(res.status).toBe(201);
    expect(res.body.workflowId).toBe('wf-1');
    expect(res.body.url).toMatch(/^\/ui-documents\//);
  });

  it('POST /ui/generate returns 400 on validation error', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/v1/ui/generate')
      .send({ workflowId: 'wf-1', stepId: 'step-1', fields: [
        { id: 'a', label: 'A', type: 'text' },
        { id: 'a', label: 'A', type: 'text' }
      ] });
    expect(res.status).toBe(400);
  });

  it('GET /ui/documents/:id returns 404 if missing', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/ui/documents/non-existent');
    expect(res.status).toBe(404);
  });

  it('GET /ui/components returns the catalogue', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/ui/components');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });
});
