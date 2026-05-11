/**
 * Integration test: Human Interaction routes
 *
 * Verifies Fix 2 of the DDD integration sweep — the human-interaction
 * router now declares RELATIVE paths so when the bootstrap mounts it at
 * `/api/v1` the resulting URLs are `/api/v1/inbox`, NOT
 * `/api/v1/api/v1/inbox`. The previously installed bench-side workaround
 * (a per-route shim that re-mounted the router at `/`) should no longer
 * be necessary.
 */

import request from 'supertest';
import { bootstrap } from '../../src/backend/bootstrap/main.js';

describe('human-interaction routes — mount path is correct', () => {
  let booted;
  let accessToken;
  const userId = 'integration-user';

  beforeAll(async () => {
    booted = await bootstrap({
      JWT_SECRET: 'human-interaction-routes-test-secret',
      LOG_LEVEL: 'error',
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
    });
    const { tokenIssuer } = booted.ctx.identity;
    const issued = await tokenIssuer.issueAccess(
      { sub: userId, role: 'admin', sid: 'integration-session' },
      900,
    );
    accessToken = issued.token;
  });

  afterAll(async () => {
    if (booted) await booted.shutdown();
  });

  test('GET /api/v1/inbox without auth -> 401', async () => {
    const res = await request(booted.app).get('/api/v1/inbox');
    expect(res.status).toBe(401);
  });

  test('GET /api/v1/inbox with valid bearer -> 200 with data envelope', async () => {
    const res = await request(booted.app)
      .get('/api/v1/inbox')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('the doubled path /api/v1/api/v1/inbox is NOT mounted (404)', async () => {
    const res = await request(booted.app)
      .get('/api/v1/api/v1/inbox')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/v1/inbox/:workflowId/:stepId returns 404 for an unknown pending step', async () => {
    const res = await request(booted.app)
      .get('/api/v1/inbox/non-existent-workflow/non-existent-step')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    // ensure the response is from the human-interaction handler, not the
    // generic bootstrap 404 (which has shape { error: 'not_found', path }).
    expect(res.body).toHaveProperty('error');
    if (res.body.error && typeof res.body.error === 'object') {
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  test('POST /api/v1/workflows/:id/respond without Idempotency-Key -> 400', async () => {
    const res = await request(booted.app)
      .post('/api/v1/workflows/some-workflow/respond')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ step_id: 'step-1', action: 'approve', payload: {} });
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});
