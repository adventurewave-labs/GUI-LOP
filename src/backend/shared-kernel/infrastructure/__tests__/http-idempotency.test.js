/**
 * http-idempotency — Idempotency-Key semantics (roadmap #18,
 * draft-ietf-httpapi-idempotency-key-header).
 */
import express from 'express';
import request from 'supertest';
import { idempotency, InMemoryHttpIdempotencyStore, fingerprint } from '../http-idempotency.js';
import { withHttpIdempotency } from '../../../contexts/workflow-orchestration/interfaces/http/idempotency.js';

function app({ store = new InMemoryHttpIdempotencyStore(), handler, subject } = {}) {
  let calls = 0;
  const a = express().use(express.json());
  a.use((req, _res, next) => { req.principal = req.get('x-user') ? { userId: req.get('x-user') } : undefined; next(); });
  a.post('/things/:id', idempotency({ store, subject }), async (req, res, next) => {
    calls += 1;
    try {
      if (handler) return await handler(req, res, calls);
      return res.status(201).json({ n: calls, id: req.params.id, body: req.body });
    } catch (err) {
      return next(err); // Express 4 does not forward async throws on its own
    }
  });
  a.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return { a, store, calls: () => calls };
}

describe('idempotency middleware', () => {
  test('no key → handler runs every time', async () => {
    const { a, calls } = app();
    await request(a).post('/things/1').send({ x: 1 }).expect(201);
    await request(a).post('/things/1').send({ x: 1 }).expect(201);
    expect(calls()).toBe(2);
  });

  test('retry with the same key and payload replays the stored response', async () => {
    const { a, calls } = app();
    const first = await request(a).post('/things/1').set('Idempotency-Key', 'k1').send({ x: 1 }).expect(201);
    const second = await request(a).post('/things/1').set('Idempotency-Key', 'k1').send({ x: 1 }).expect(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(calls()).toBe(1);
  });

  test('same key, different payload → 422', async () => {
    const { a, calls } = app();
    await request(a).post('/things/1').set('Idempotency-Key', 'k2').send({ x: 1 }).expect(201);
    const res = await request(a).post('/things/1').set('Idempotency-Key', 'k2').send({ x: 2 }).expect(422);
    expect(res.body.error).toBe('idempotency_key_reused');
    expect(calls()).toBe(1);
  });

  test('concurrent duplicate while the first is in flight → 409 with Retry-After', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { a, calls } = app({ handler: async (_req, res) => { await gate; res.status(201).json({ ok: true }); } });
    // supertest is lazy: .then() actually starts the first request now.
    const first = request(a).post('/things/1').set('Idempotency-Key', 'k3').send({}).then((r) => r);
    await new Promise((r) => setTimeout(r, 30));
    const dup = await request(a).post('/things/1').set('Idempotency-Key', 'k3').send({}).expect(409);
    expect(dup.headers['retry-after']).toBe('1');
    expect(dup.body.error).toBe('idempotency_in_flight');
    release();
    expect((await first).status).toBe(201);
    expect(calls()).toBe(1);
  });

  test('5xx responses and thrown errors are not cached — the retry runs again', async () => {
    const { a, calls } = app({
      handler: async (_req, res, n) => {
        if (n === 1) return res.status(503).json({ error: 'busy' });
        if (n === 2) throw new Error('boom');
        return res.status(201).json({ n });
      },
    });
    await request(a).post('/things/1').set('Idempotency-Key', 'k4').send({}).expect(503);
    await request(a).post('/things/1').set('Idempotency-Key', 'k4').send({}).expect(500);
    const ok = await request(a).post('/things/1').set('Idempotency-Key', 'k4').send({}).expect(201);
    expect(ok.body).toEqual({ n: 3 });
    await request(a).post('/things/1').set('Idempotency-Key', 'k4').send({}).expect(201, { n: 3 });
    expect(calls()).toBe(3);
  });

  test('4xx responses are cached (the request itself was wrong)', async () => {
    const { a, calls } = app({ handler: async (_req, res) => res.status(400).json({ error: 'bad' }) });
    await request(a).post('/things/1').set('Idempotency-Key', 'k5').send({}).expect(400);
    await request(a).post('/things/1').set('Idempotency-Key', 'k5').send({}).expect(400);
    expect(calls()).toBe(1);
  });

  test('keys are scoped by concrete path and by subject', async () => {
    const { a, calls } = app();
    await request(a).post('/things/A').set('Idempotency-Key', 'same').send({}).expect(201, { n: 1, id: 'A', body: {} });
    // Same key, other resource: a different request, not a replay of A (old bug).
    await request(a).post('/things/B').set('Idempotency-Key', 'same').send({}).expect(201, { n: 2, id: 'B', body: {} });
    // Same key, other user.
    await request(a).post('/things/A').set('x-user', 'u2').set('Idempotency-Key', 'same').send({}).expect(201);
    expect(calls()).toBe(3);
  });

  test.each(['', 'a'.repeat(256), 'has space', 'tab\tkey', 'ünïcode'])('malformed key %p → 400 (empty = no key)', async (key) => {
    const { a } = app();
    const res = await request(a).post('/things/1').set('Idempotency-Key', key).send({});
    expect(res.status).toBe(key === '' ? 201 : 400);
  });

  test('store errors on begin surface as errors, not silent double execution', async () => {
    const broken = { begin: async () => { throw new Error('db down'); }, complete: async () => {}, release: async () => {} };
    const { a, calls } = app({ store: broken });
    await request(a).post('/things/1').set('Idempotency-Key', 'k6').send({}).expect(500, { error: 'db down' });
    expect(calls()).toBe(0);
  });
});

describe('InMemoryHttpIdempotencyStore', () => {
  test('expired entries and abandoned locks are reclaimed', async () => {
    let t = 0;
    const s = new InMemoryHttpIdempotencyStore({ now: () => t, ttlMs: 1000, lockMs: 100 });
    expect(await s.begin('a', 'f')).toEqual({ state: 'new' });
    expect(await s.begin('a', 'f')).toEqual({ state: 'in-flight' });
    t = 150;
    expect(await s.begin('a', 'f')).toEqual({ state: 'new' }); // stale lock taken over
    await s.complete('a', { status: 201, body: { ok: 1 } });
    expect(await s.begin('a', 'f')).toEqual({ state: 'replay', response: { status: 201, body: { ok: 1 } } });
    expect(await s.begin('a', 'g')).toEqual({ state: 'mismatch' });
    t = 2000;
    expect(await s.begin('a', 'g')).toEqual({ state: 'new' }); // expired
    await s.release('a');
    expect(await s.begin('a', 'h')).toEqual({ state: 'new' });
  });

  test('fingerprint is stable and payload-sensitive', () => {
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint(undefined)).toBe(fingerprint(null));
  });
});

describe('withHttpIdempotency (workflow router adapter)', () => {
  test('replays per concrete path and runs the handler once', async () => {
    let n = 0;
    const store = new InMemoryHttpIdempotencyStore();
    const a = express().use(express.json());
    a.post('/wf/:id/execute', (req, res, next) => withHttpIdempotency({
      store,
      handler: async (rq, rs) => { n += 1; rs.json({ id: rq.params.id, n }); },
    })(req, res, next).catch(next));
    await request(a).post('/wf/A/execute').set('Idempotency-Key', 'k').send({}).expect(200, { id: 'A', n: 1 });
    await request(a).post('/wf/A/execute').set('Idempotency-Key', 'k').send({}).expect(200, { id: 'A', n: 1 });
    await request(a).post('/wf/B/execute').set('Idempotency-Key', 'k').send({}).expect(200, { id: 'B', n: 2 });
  });
});

describe('PgHttpIdempotencyStore (scripted pool; real-PG behaviour is in the contract suite)', () => {
  // Answers queries in order by matching SQL fragments; records what was sent.
  const scripted = (answers) => {
    const sent = [];
    return {
      sent,
      query: async (sql, params) => {
        sent.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        const a = answers.find((x) => sql.includes(x.match) && !x.used);
        if (!a) return { rowCount: 0, rows: [] };
        if (a.once) a.used = true;
        return typeof a.res === 'function' ? a.res(params) : a.res;
      },
    };
  };
  const PgStore = async () => (await import('../http-idempotency.js')).PgHttpIdempotencyStore;

  test('claim wins → new; UUID actor stored, non-UUID actor nulled', async () => {
    const Pg = await PgStore();
    const pool = scripted([{ match: 'INSERT INTO idempotency_keys', res: { rowCount: 1, rows: [{ id: 1 }] } }]);
    const s = new Pg(pool, { ttlMs: 1000 });
    expect(await s.begin('sc', 'fp', { actorId: '3f2b8c1e-9d4a-4e7b-8c2d-1a2b3c4d5e6f', route: 'POST /x', key: 'k' })).toEqual({ state: 'new' });
    expect(await s.begin('sc2', 'fp', { actorId: 'ip:1.2.3.4' })).toEqual({ state: 'new' });
    const inserts = pool.sent.filter((q) => q.sql.startsWith('INSERT'));
    expect(inserts[0].params).toEqual(['sc', '3f2b8c1e-9d4a-4e7b-8c2d-1a2b3c4d5e6f', 'POST /x', 'k', 'fp', '1000']);
    expect(inserts[1].params[1]).toBeNull();
    expect(pool.sent[0].sql).toMatch(/^DELETE FROM idempotency_keys WHERE scope_key = \$1 AND expires_at <= NOW\(\)/);
  });

  test.each([
    [{ request_hash: 'other', status_code: 201, response_body: {}, stale: false }, { state: 'mismatch' }],
    [{ request_hash: 'fp', status_code: 201, response_body: { a: 1 }, stale: false }, { state: 'replay', response: { status: 201, body: { a: 1 } } }],
    [{ request_hash: 'fp', status_code: 0, response_body: null, stale: false }, { state: 'in-flight' }],
  ])('existing row %j → %j', async (row, want) => {
    const Pg = await PgStore();
    const s = new Pg(scripted([{ match: 'SELECT request_hash', res: { rows: [row] } }]));
    expect(await s.begin('sc', 'fp')).toEqual(want);
  });

  test('stale lock: takeover succeeds → new; lost takeover race → in-flight', async () => {
    const Pg = await PgStore();
    const stale = { match: 'SELECT request_hash', res: { rows: [{ request_hash: 'fp', status_code: 0, stale: true }] } };
    const won = new Pg(scripted([stale, { match: 'UPDATE idempotency_keys SET created_at', res: { rowCount: 1 } }]));
    expect(await won.begin('sc', 'fp')).toEqual({ state: 'new' });
    const lost = new Pg(scripted([stale, { match: 'UPDATE idempotency_keys SET created_at', res: { rowCount: 0 } }]));
    expect(await lost.begin('sc', 'fp')).toEqual({ state: 'in-flight' });
  });

  test('row vanished between claim and read (raced a delete) → retries the claim', async () => {
    const Pg = await PgStore();
    const pool = scripted([
      { match: 'INSERT INTO idempotency_keys', once: true, res: { rowCount: 0, rows: [] } },
      { match: 'SELECT request_hash', once: true, res: { rows: [] } },
      { match: 'INSERT INTO idempotency_keys', res: { rowCount: 1, rows: [{ id: 2 }] } },
    ]);
    expect(await new Pg(pool).begin('sc', 'fp')).toEqual({ state: 'new' });
  });

  test('complete stores status + JSON body; release only deletes in-flight rows', async () => {
    const Pg = await PgStore();
    const pool = scripted([]);
    const s = new Pg(pool);
    await s.complete('sc', { status: 201, body: { id: 'x' } });
    await s.complete('sc2', { status: 204, body: undefined });
    await s.release('sc');
    expect(pool.sent[0].params).toEqual(['sc', 201, '{"id":"x"}']);
    expect(pool.sent[1].params).toEqual(['sc2', 204, 'null']);
    expect(pool.sent[2].sql).toBe('DELETE FROM idempotency_keys WHERE scope_key = $1 AND status_code = 0');
  });
});
