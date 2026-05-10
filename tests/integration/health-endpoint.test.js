/**
 * Integration tests for the GET /health endpoint.
 *
 * Exercises the new shape introduced by the observability follow-up:
 *   subsystems.db    = { status, connected }
 *   subsystems.redis = { status, connected }
 *   subsystems.outbox = { lag_ms, pending_count }
 *
 * Cases:
 *   1. All-green in-memory boot: status 'ok'.
 *   2. Pool absent: db.connected === false (still 'ok').
 *   3. Pending outbox events: lag_ms > 0 and pending_count matches.
 */

import request from 'supertest';
import { bootstrap } from '../../src/backend/bootstrap/main.js';

describe('GET /health (DDD bootstrap)', () => {
  let booted;

  beforeAll(async () => {
    booted = await bootstrap({
      JWT_SECRET: 'health-test-secret-change-me',
      LOG_LEVEL: 'error',
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
    });
  });

  afterAll(async () => {
    if (booted) await booted.shutdown();
  });

  test('all-green path: returns 200 and status: ok with the new shape', async () => {
    const res = await request(booted.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toEqual(expect.any(String));
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

  test('in-memory mode reports db.connected: false', async () => {
    const res = await request(booted.app).get('/health');
    expect(res.body.subsystems.db.connected).toBe(false);
    expect(res.body.subsystems.db.status).toBe('disabled');
    expect(res.body.subsystems.redis.connected).toBe(false);
  });

  test('several pending outbox events surface as lag_ms > 0 and pending_count = N', async () => {
    // Drain anything the bootstrap may have queued (template seeding etc.)
    // to get a clean baseline, then enqueue events with a known past
    // occurredAt so lag is positive and reproducible.
    const outbox = booted.ctx.outbox;
    if (typeof outbox.clear === 'function') outbox.clear();

    const past = new Date(Date.now() - 500).toISOString();
    const events = [
      makeFakeEvent({ id: 'e-1', occurredAt: past }),
      makeFakeEvent({ id: 'e-2', occurredAt: past }),
      makeFakeEvent({ id: 'e-3', occurredAt: past }),
    ];
    await outbox.enqueue(events);

    const res = await request(booted.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.subsystems.outbox.pending_count).toBe(3);
    expect(res.body.subsystems.outbox.lag_ms).toBeGreaterThan(0);
  });
});

function makeFakeEvent({ id, occurredAt }) {
  return {
    toJSON() {
      return {
        eventId: id,
        eventType: 'test.fake_event',
        eventVersion: 1,
        aggregateId: id,
        aggregateType: 'Test',
        payload: {},
        occurredAt,
        correlationId: id,
      };
    },
  };
}
