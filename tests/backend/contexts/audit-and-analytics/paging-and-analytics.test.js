/**
 * Paging clamp + analytics query fallbacks (roadmap 15b).
 *
 * Regression: `?limit=-1` went straight into SQL LIMIT (Postgres error → 500)
 * and `?limit=10000000` was an unbounded scan.
 */
import express from 'express';
import request from 'supertest';
import { parsePaging } from '../../../../src/backend/contexts/audit-and-analytics/interfaces/http/paging.js';
import { createAnalyticsRouter } from '../../../../src/backend/contexts/audit-and-analytics/interfaces/http/analytics-router.js';
import { createAuditRouter } from '../../../../src/backend/contexts/audit-and-analytics/interfaces/http/audit-router.js';
import { GetWorkflowAnalyticsQuery } from '../../../../src/backend/contexts/audit-and-analytics/application/queries/get-workflow-analytics.js';

describe('parsePaging', () => {
  test.each([
    [{}, { limit: 100, offset: 0 }],
    [{ limit: '25', offset: '50' }, { limit: 25, offset: 50 }],
    [{ limit: '-1', offset: '-5' }, { limit: 100, offset: 0 }],
    [{ limit: '0' }, { limit: 100, offset: 0 }],
    [{ limit: '10000000' }, { limit: 1000, offset: 0 }],
    [{ limit: 'abc', offset: 'x' }, { limit: 100, offset: 0 }],
    [{ offset: '99999999' }, { limit: 100, offset: 1000000 }],
  ])('%j → %j', (q, want) => {
    expect(parsePaging(q)).toEqual(want);
  });

  test('custom bounds', () => {
    expect(parsePaging({ limit: '9000' }, { defaultLimit: 1000, maxLimit: 5000 })).toEqual({ limit: 5000, offset: 0 });
    expect(parsePaging({}, { defaultLimit: 1000 })).toEqual({ limit: 1000, offset: 0 });
  });
});

describe('routers forward clamped paging', () => {
  test('analytics: negative / huge limits never reach the query', async () => {
    const seen = [];
    const q = { execute: async (args) => { seen.push(args); return []; } };
    const app = express().use(createAnalyticsRouter({ getWorkflowAnalyticsQuery: q, getUserActivityQuery: q }));
    await request(app).get('/analytics/workflows?limit=-1&offset=-3').expect(200);
    await request(app).get('/analytics/users/u-1?limit=10000000').expect(200);
    expect(seen).toEqual([
      { limit: 100, offset: 0 },
      { userId: 'u-1', limit: 1000, offset: 0 },
    ]);
  });

  test('analytics: query errors reach the error handler', async () => {
    const boom = { execute: async () => { throw new Error('db down'); } };
    const app = express()
      .use(createAnalyticsRouter({ getWorkflowAnalyticsQuery: boom, getUserActivityQuery: boom }))
      .use((err, _req, res, _next) => res.status(503).json({ error: err.message }));
    await request(app).get('/analytics/workflows').expect(503, { error: 'db down' });
    await request(app).get('/analytics/users/x').expect(503);
  });

  test('audit trail caps at the store limit', async () => {
    const seen = [];
    const getAuditTrailQuery = { execute: async (args) => { seen.push(args); return []; } };
    const app = express().use(express.json()).use(createAuditRouter({
      getWorkflowTrailQuery: getAuditTrailQuery,
      getAuditTrailQuery,
      exportComplianceDataCommand: { execute: async () => ({}) },
    }));
    const paths = ['/audit/workflows/wf-1?limit=99999&offset=-1', '/audit/aggregates/Workflow/wf-1', '/audit/workflows/wf-1?limit=-7'];
    for (const p of paths) await request(app).get(p).expect(200);
    const ranges = seen.map((a) => a.range);
    expect(ranges).toHaveLength(3);
    expect(ranges[0]).toEqual(expect.objectContaining({ limit: 5000, offset: 0 }));
    expect(ranges[1]).toEqual(expect.objectContaining({ limit: 1000, offset: 0 }));
    expect(ranges[2]).toEqual(expect.objectContaining({ limit: 1000, offset: 0 }));
    for (const r of ranges) {
      expect(r.limit).toBeLessThanOrEqual(5000);
      expect(r.offset).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('GetWorkflowAnalyticsQuery fallbacks', () => {
  test('no pool → []', async () => {
    expect(await new GetWorkflowAnalyticsQuery({ pool: null }).execute()).toEqual([]);
  });

  test('missing view (42P01 or "does not exist") → []', async () => {
    const missing = { query: async () => { throw Object.assign(new Error('relation "workflow_analytics" does not exist'), { code: '42P01' }); } };
    expect(await new GetWorkflowAnalyticsQuery({ pool: missing }).execute()).toEqual([]);
    const byMessage = { query: async () => { throw new Error('view does not exist'); } };
    expect(await new GetWorkflowAnalyticsQuery({ pool: byMessage }).execute()).toEqual([]);
  });

  test('any other error propagates; params are forwarded', async () => {
    const broken = { query: async () => { throw Object.assign(new Error('timeout'), { code: '57014' }); } };
    await expect(new GetWorkflowAnalyticsQuery({ pool: broken }).execute()).rejects.toThrow('timeout');
    let params;
    const ok = { query: async (_sql, p) => { params = p; return { rows: [{ id: 1 }] }; } };
    expect(await new GetWorkflowAnalyticsQuery({ pool: ok }).execute({ limit: 5, offset: 10 })).toEqual([{ id: 1 }]);
    expect(params).toEqual([5, 10]);
  });
});
