/**
 * Audit & Analytics context — API smoke tests for routers.
 */

import express from 'express';
import request from 'supertest';

import { createAuditRouter } from '../../../../src/backend/contexts/audit-and-analytics/interfaces/http/audit-router.js';
import { createAnalyticsRouter } from '../../../../src/backend/contexts/audit-and-analytics/interfaces/http/analytics-router.js';
import { createDashboardRouter } from '../../../../src/backend/contexts/audit-and-analytics/interfaces/http/dashboard-router.js';

import { GetWorkflowTrailQuery } from '../../../../src/backend/contexts/audit-and-analytics/application/queries/get-workflow-trail.js';
import { GetAuditTrailQuery } from '../../../../src/backend/contexts/audit-and-analytics/application/queries/get-audit-trail.js';
import { ExportComplianceDataCommand } from '../../../../src/backend/contexts/audit-and-analytics/application/commands/export-compliance-data.js';
import { GetWorkflowAnalyticsQuery } from '../../../../src/backend/contexts/audit-and-analytics/application/queries/get-workflow-analytics.js';
import { GetUserActivityQuery } from '../../../../src/backend/contexts/audit-and-analytics/application/queries/get-user-activity.js';
import { GetActiveWorkflowsQuery } from '../../../../src/backend/contexts/audit-and-analytics/application/queries/get-active-workflows.js';

import { InMemoryEventStore } from '../../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/inmemory-event-store.js';
import { InMemoryAuditLogStore } from '../../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/inmemory-audit-log-store.js';
import { InMemoryStorage } from '../../../../src/backend/contexts/ui-generation/infrastructure/storage/inmemory-storage.js';

const fakePool = {
  async query(sql) {
    if (sql.includes('workflow_analytics')) return { rows: [{ id: 'wf-1', count: 1 }] };
    if (sql.includes('user_activity')) return { rows: [{ user_id: 'u-1', actions: 3 }] };
    if (sql.includes('active_workflows')) return { rows: [{ id: 'wf-1', state: 'running' }] };
    return { rows: [] };
  }
};

function buildApp() {
  const ev = new InMemoryEventStore([
    {
      id: 'e1',
      type: 'workflow.started',
      aggregate_type: 'Workflow',
      aggregate_id: 'wf-1',
      occurred_at: '2026-05-09T08:00:00.000Z'
    }
  ]);
  const lg = new InMemoryAuditLogStore([]);
  const storage = new InMemoryStorage();

  const app = express();
  app.use('/api/v1', createAuditRouter({
    getWorkflowTrailQuery: new GetWorkflowTrailQuery({ eventStore: ev, auditLogStore: lg }),
    getAuditTrailQuery: new GetAuditTrailQuery({ eventStore: ev, auditLogStore: lg }),
    exportComplianceDataCommand: new ExportComplianceDataCommand({
      eventStore: ev, auditLogStore: lg, objectStorage: storage
    })
  }));
  app.use('/api/v1', createAnalyticsRouter({
    getWorkflowAnalyticsQuery: new GetWorkflowAnalyticsQuery({ pool: fakePool }),
    getUserActivityQuery: new GetUserActivityQuery({ pool: fakePool })
  }));
  app.use('/api/v1', createDashboardRouter({
    getActiveWorkflowsQuery: new GetActiveWorkflowsQuery({ pool: fakePool })
  }));

  return app;
}

describe('audit/analytics/dashboard routers', () => {
  it('GET /audit/workflows/:id returns the trail', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/v1/audit/workflows/wf-1');
    expect(res.status).toBe(200);
    expect(res.body.workflowId).toBe('wf-1');
    expect(res.body.items.length).toBe(1);
  });

  it('GET /audit/aggregates/:type/:id returns events and logs', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/v1/audit/aggregates/Workflow/wf-1');
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(1);
    expect(res.body.logs).toEqual([]);
  });

  it('POST /audit/exports returns a download URL', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/audit/exports')
      .send({ aggregateType: 'Workflow', aggregateId: 'wf-1' });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/ui-documents\/compliance-exports\//);
  });

  it('GET /analytics/workflows returns rows from the view', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/v1/analytics/workflows');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('GET /dashboards/active-workflows returns rows', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/v1/dashboards/active-workflows');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });
});
