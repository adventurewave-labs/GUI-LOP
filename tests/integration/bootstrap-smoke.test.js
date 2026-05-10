/**
 * Smoke test for the v1 (DDD) composition root.
 *
 * Boots the full stack with in-memory adapters (no DATABASE_URL, no
 * REDIS_URL), verifies the health endpoint, the workflow templates seed,
 * and that shutdown returns cleanly.
 */

import request from 'supertest';
import { bootstrap } from '../../src/backend/bootstrap/main.js';

describe('bootstrap composition root (in-memory)', () => {
  let booted;

  beforeAll(async () => {
    booted = await bootstrap({
      JWT_SECRET: 'smoke-test-secret-change-me',
      LOG_LEVEL: 'error',
      // Force in-memory: leave DATABASE_URL and REDIS_URL undefined.
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
    });
  });

  afterAll(async () => {
    if (booted) await booted.shutdown();
  });

  test('GET /health returns 200 and an ok status envelope', async () => {
    const res = await request(booted.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toEqual(expect.any(String));
    expect(res.body.message).toEqual(expect.any(String));
    expect(res.body.subsystems).toEqual(
      expect.objectContaining({
        db: expect.objectContaining({
          status: expect.any(String),
          connected: expect.any(Boolean),
        }),
        redis: expect.objectContaining({
          status: expect.any(String),
          connected: expect.any(Boolean),
        }),
        outbox: expect.objectContaining({
          lag_ms: expect.any(Number),
          pending_count: expect.any(Number),
        }),
      }),
    );
  });

  test('GET /api/v1/workflows/templates returns the three seeded templates', async () => {
    // Mint an access token via the in-process token issuer so the auth
    // middleware lets the request through.
    const accessToken = await mintTestToken(booted);

    const res = await request(booted.app)
      .get('/api/v1/workflows/templates')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data?.templates)).toBe(true);
    const keys = res.body.data.templates.map((t) => t.key ?? t.template_key ?? t.templateKey);
    expect(keys).toEqual(
      expect.arrayContaining(['data-analysis', 'decision-making', 'content-creation']),
    );
  });

  test('shutdown() resolves cleanly', async () => {
    const local = await bootstrap({
      JWT_SECRET: 'smoke-test-secret-change-me',
      LOG_LEVEL: 'error',
    });
    await expect(local.shutdown()).resolves.toBeUndefined();
  });
});

async function mintTestToken({ ctx }) {
  const { tokenIssuer } = ctx.identity;
  const { token } = await tokenIssuer.issueAccess(
    { sub: 'smoke-user', role: 'admin', sid: 'smoke-session' },
    900,
  );
  return token;
}
