/**
 * rate-limiters.test.js — key normalisation + factory semantics.
 */
import express from 'express';
import request from 'supertest';
import { ipBucket, identifierKey, createRateLimiterFactory } from '../rate-limiters.js';

describe('ipBucket', () => {
  test.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:db8:1:2:ffff::9', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    [undefined, 'unknown'],
  ])('%p → %p', (ip, want) => {
    expect(ipBucket(ip)).toBe(want);
  });

  test('rotating within one /64 shares a bucket', () => {
    expect(ipBucket('2001:db8:aa:bb::1')).toBe(ipBucket('2001:db8:aa:bb:dead:beef:0:42'));
  });
});

describe('identifierKey', () => {
  test('case/whitespace-insensitive, never the raw value', () => {
    const k = identifierKey('  Alice@Example.COM ');
    expect(k).toBe(identifierKey('alice@example.com'));
    expect(k).not.toContain('alice');
    expect(identifierKey('')).toBeNull();
    expect(identifierKey(undefined)).toBeNull();
  });
});

function appWith(mw) {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.post('/x', mw, (req, res) => res.status(req.body?.ok ? 200 : 401).json({}));
  app.get('/x', mw, (_req, res) => res.json({}));
  return app;
}

describe('createRateLimiterFactory', () => {
  test('memory backend without redis; draft-7 headers; JSON 429', async () => {
    const create = await createRateLimiterFactory({});
    expect(create.backend).toBe('memory');
    const app = appWith(create('t1', { windowMs: 60_000, limit: 2, message: 'slow down' }));
    const r1 = await request(app).get('/x');
    expect(r1.headers.ratelimit).toMatch(/limit=2, remaining=1, reset=\d+/);
    expect(r1.headers['ratelimit-policy']).toBe('2;w=60');
    expect(r1.headers['x-ratelimit-limit']).toBeUndefined();
    await request(app).get('/x');
    const r3 = await request(app).get('/x');
    expect(r3.status).toBe(429);
    expect(r3.body).toEqual(expect.objectContaining({ error: 'rate_limited', message: 'slow down' }));
  });

  test('skipSuccessfulRequests counts only failures', async () => {
    const create = await createRateLimiterFactory({});
    const app = appWith(create('t2', { windowMs: 60_000, limit: 2, skipSuccessfulRequests: true }));
    for (let i = 0; i < 5; i++) await request(app).post('/x').send({ ok: true }).expect(200);
    await request(app).post('/x').send({}).expect(401);
    await request(app).post('/x').send({}).expect(401);
    await request(app).post('/x').send({}).expect(429);
  });

  test('redis backend uses RedisStore via ioredis-style call()', async () => {
    const calls = [];
    const fakeRedis = {
      call: async (...args) => {
        calls.push(args);
        if (args[0] === 'SCRIPT') return 'sha1';
        if (args[0] === 'EVALSHA') return [1, 60000];
        return null;
      },
    };
    const create = await createRateLimiterFactory({ redis: fakeRedis });
    expect(create.backend).toBe('redis');
    const app = appWith(create('login-ip', { windowMs: 60_000, limit: 5 }));
    await request(app).get('/x').set('X-Forwarded-For', '198.51.100.9').expect(200);
    const evals = calls.filter((c) => c[0] === 'EVALSHA');
    expect(evals.length).toBeGreaterThan(0);
    expect(evals[0]).toContain('rl:login-ip:198.51.100.9');
  });

  test('failClosed: store errors → 503; fail-open passes through', async () => {
    const broken = { call: async () => { throw new Error('redis down'); } };
    const create = await createRateLimiterFactory({ redis: broken });
    const closed = appWith(create('auth', { windowMs: 60_000, limit: 5, failClosed: true }));
    const open = appWith(create('api', { windowMs: 60_000, limit: 5 }));
    await request(closed).get('/x').expect(503);
    await request(open).get('/x').expect(200);
  });

  test('Redis down at construction does not produce an unhandled rejection', async () => {
    const unhandled = [];
    const onUnhandled = (r) => unhandled.push(r);
    process.on('unhandledRejection', onUnhandled);
    try {
      const broken = { call: async () => { throw new Error('ECONNREFUSED'); } };
      const create = await createRateLimiterFactory({ redis: broken });
      create('boot', { windowMs: 60_000, limit: 5 });
      await new Promise((r) => { setTimeout(r, 20); });
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('recovers once Redis comes back (script reloaded on NOSCRIPT)', async () => {
    let up = false;
    const flaky = {
      call: async (...args) => {
        if (!up) throw new Error('ECONNREFUSED');
        if (args[0] === 'SCRIPT') return 'realsha';
        if (args[0] === 'EVALSHA') {
          if (args[1] !== 'realsha') throw new Error('NOSCRIPT No matching script');
          return [1, 60000];
        }
        return null;
      },
    };
    const create = await createRateLimiterFactory({ redis: flaky });
    const app = appWith(create('recover', { windowMs: 60_000, limit: 5, failClosed: true }));
    await request(app).get('/x').expect(503);
    up = true;
    await request(app).get('/x').expect(200);
  });
});
