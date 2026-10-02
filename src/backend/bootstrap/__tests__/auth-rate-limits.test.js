/**
 * auth-rate-limits.test.js — ADR 0015 limits through the booted app.
 *
 * TRUST_PROXY=true lets each test choose its client IP via X-Forwarded-For,
 * so we can simulate distributed attackers.
 */
import request from 'supertest';
import { bootstrap } from '../main.js';

async function boot(extra = {}) {
  return bootstrap({
    JWT_SECRET: 'rate-limit-secret',
    LOG_LEVEL: 'error',
    NODE_ENV: 'test',
    TRUST_PROXY: 'true',
    ...extra,
  });
}

const login = (app, ip, identifier, password = 'wrong-password') =>
  request(app)
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ identifier, password });

describe('auth rate limits', () => {
  let booted;
  beforeEach(async () => { booted = await boot(); });
  afterEach(() => booted?.shutdown());

  test('distributed credential stuffing on one account is cut off after 5 failures', async () => {
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const res = await login(booted.app, `198.51.100.${i + 1}`, 'Victim@Example.com');
      statuses.push(res.status);
    }
    // Every attempt came from a different IP: per-IP limits alone allow all 7.
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  test('identifier bucket is case/whitespace-insensitive', async () => {
    for (let i = 0; i < 5; i++) await login(booted.app, `203.0.113.${i + 1}`, 'bob@example.com');
    const res = await login(booted.app, '203.0.113.99', '  BOB@example.COM ');
    expect(res.status).toBe(429);
  });

  test('one IP spraying many accounts hits the per-IP limit', async () => {
    const statuses = [];
    for (let i = 0; i < 22; i++) {
      statuses.push((await login(booted.app, '192.0.2.50', `user${i}@example.com`)).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBe(2);
  });

  test('429 carries draft-7 RateLimit headers and a JSON body', async () => {
    let res;
    for (let i = 0; i < 6; i++) res = await login(booted.app, `192.0.2.${i + 1}`, 'carol@example.com');
    expect(res.status).toBe(429);
    expect(res.headers.ratelimit).toMatch(/remaining=0/);
    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.body).toEqual(expect.objectContaining({ error: 'rate_limited', request_id: expect.any(String) }));
  });

  test('registration is limited per IP (5/hour)', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(booted.app)
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', '192.0.2.200')
        .send({ email: `new${i}@example.com`, password: 'Sup3r-Secret-Pass!', username: `new${i}` });
      statuses.push(res.status);
    }
    expect(statuses[5]).toBe(429);
    expect(statuses.slice(0, 5)).not.toContain(429);
  });

  test('password change is limited per authenticated user', async () => {
    const { token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: 'pw-user', role: 'user', sid: 's1' }, 300);
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(booted.app)
        .post('/api/v1/auth/password')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', `192.0.2.${100 + i}`) // rotating IPs don't help
        .send({ oldPassword: 'guess', newPassword: 'N3w-Password-Value!' });
      statuses.push(res.status);
    }
    expect(statuses[5]).toBe(429);
  });
});

describe('general API limit', () => {
  test('RATE_LIMIT_MAX applies per client IP on /api/v1, not to probes', async () => {
    const booted = await boot({ RATE_LIMIT_MAX: '3', RATE_LIMIT_WINDOW_MS: '60000' });
    try {
      const statuses = [];
      for (let i = 0; i < 4; i++) {
        statuses.push((await request(booted.app).get('/api/v1/workflows/templates').set('X-Forwarded-For', '192.0.2.9')).status);
      }
      expect(statuses[3]).toBe(429);
      // A different client still has budget.
      expect((await request(booted.app).get('/api/v1/workflows/templates').set('X-Forwarded-For', '192.0.2.10')).status).not.toBe(429);
      // Probes aren't under /api/v1.
      for (let i = 0; i < 5; i++) await request(booted.app).get('/livez').set('X-Forwarded-For', '192.0.2.9').expect(200);
    } finally {
      await booted.shutdown();
    }
  });
});
