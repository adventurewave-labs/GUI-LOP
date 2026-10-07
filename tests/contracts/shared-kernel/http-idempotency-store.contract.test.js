/**
 * HTTP idempotency store contract (roadmap #18): in-memory and Postgres
 * (idempotency_keys, migrations 003 + 013) must behave identically, and the
 * Postgres claim must be atomic across concurrent callers — that is what
 * stops a retry that lands on another replica from executing twice.
 */
import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryHttpIdempotencyStore, PgHttpIdempotencyStore } from '../../../src/backend/shared-kernel/infrastructure/http-idempotency.js';

describeIfDocker('HttpIdempotencyStore contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemoryHttpIdempotencyStore(),
    postgres: () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgHttpIdempotencyStore(pg.pool);
  }, 90_000);
  afterAll(async () => { if (pg) await pg.cleanup(); });
  beforeEach(async () => { if (pg) await pg.truncate(); });

  describe.each([['in-memory'], ['postgres']])('%s', (label) => {
    let s;
    beforeEach(() => { s = make[label](); });

    test('new → in-flight → complete → replay; mismatch on a different fingerprint', async () => {
      expect(await s.begin('scope-1', 'fp-a', { route: 'POST /x', key: 'k' })).toEqual({ state: 'new' });
      expect(await s.begin('scope-1', 'fp-a')).toEqual({ state: 'in-flight' });
      expect(await s.begin('scope-1', 'fp-b')).toEqual({ state: 'mismatch' });
      await s.complete('scope-1', { status: 201, body: { id: 'w1', nested: { ok: true } } });
      expect(await s.begin('scope-1', 'fp-a')).toEqual({ state: 'replay', response: { status: 201, body: { id: 'w1', nested: { ok: true } } } });
      expect(await s.begin('scope-1', 'fp-b')).toEqual({ state: 'mismatch' });
    });

    test('release frees an in-flight scope (failed request may be retried)', async () => {
      await s.begin('scope-2', 'fp', {});
      await s.release('scope-2');
      expect(await s.begin('scope-2', 'fp', {})).toEqual({ state: 'new' });
    });

    test('scopes are independent; anonymous (non-UUID actor) scopes are still unique', async () => {
      expect(await s.begin('anon-1', 'fp', { actorId: 'ip:1.2.3.4', route: 'POST /register', key: 'k' })).toEqual({ state: 'new' });
      expect(await s.begin('anon-2', 'fp', { actorId: 'ip:5.6.7.8', route: 'POST /register', key: 'k' })).toEqual({ state: 'new' });
      expect(await s.begin('anon-1', 'fp', { actorId: 'ip:1.2.3.4', route: 'POST /register', key: 'k' })).toEqual({ state: 'in-flight' });
    });
  });

  test('postgres: 10 concurrent claims of one scope — exactly one wins', async () => {
    const stores = Array.from({ length: 10 }, () => new PgHttpIdempotencyStore(pg.pool));
    const results = await Promise.all(stores.map((st) => st.begin('race', 'fp', { route: 'POST /w', key: 'k' })));
    expect(results.filter((r) => r.state === 'new')).toHaveLength(1);
    expect(results.filter((r) => r.state === 'in-flight')).toHaveLength(9);
  });

  test('postgres: a stale lock (crashed replica) is taken over; expired rows are ignored', async () => {
    const s = new PgHttpIdempotencyStore(pg.pool, { lockMs: 50, ttlMs: 60_000 });
    await s.begin('stale', 'fp', {});
    await new Promise((r) => setTimeout(r, 80));
    expect(await s.begin('stale', 'fp', {})).toEqual({ state: 'new' });

    const short = new PgHttpIdempotencyStore(pg.pool, { ttlMs: 30 });
    await short.begin('ttl', 'fp-1', {});
    await short.complete('ttl', { status: 200, body: {} });
    await new Promise((r) => setTimeout(r, 60));
    expect(await short.begin('ttl', 'fp-2', {})).toEqual({ state: 'new' });
  });
});
