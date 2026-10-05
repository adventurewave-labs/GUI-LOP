/**
 * Outbox delivery on real Postgres (roadmap #20).
 *
 * Regressions pinned here:
 *   - the OutboxConsumer called fetchPending(), which the Pg adapter lacked:
 *     every tick threw and the outbox never drained with a database;
 *   - markFailed() set a terminal 'failed' status nothing retried, so one
 *     transient error lost the event.
 */
import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { createPgOutboxRepository } from '../../../src/backend/shared-kernel/infrastructure/pg-outbox-repository.js';
import { OutboxConsumer } from '../../../src/backend/contexts/notification/application/services/outbox-consumer.js';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const event = (n, at) => ({
  toJSON: () => ({
    eventId: uuid(n), eventType: 'test.happened', eventVersion: 1,
    aggregateId: uuid(9000 + n), aggregateType: 'Test', payload: { n },
    occurredAt: at ?? new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  }),
});
const ok = { isOk: () => true };
const fail = (m) => ({ isOk: () => false, error: new Error(m) });

describeIfDocker('Outbox delivery contract (Postgres)', () => {
  let pg;
  let outbox;
  beforeAll(async () => { pg = await startPostgres(); }, 90_000);
  afterAll(async () => { if (pg) await pg.cleanup(); });
  beforeEach(async () => {
    await pg.truncate();
    outbox = createPgOutboxRepository(pg.pool);
  });
  // Enqueue must share a transaction client — passing the pool (as this
  // helper once did via `{ client: pg.pool }`) is now refused by the guard.
  const enqueue = async (...evs) => {
    const client = await pg.pool.connect();
    try {
      await client.query('BEGIN');
      await outbox.enqueue(evs, { client });
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* connection gone; release below */ }
      throw err;
    } finally {
      client.release();
    }
  };
  const rows = async () => (await pg.pool.query('SELECT event_id, status, retry_count, last_error, next_attempt_at, locked_until FROM outbox ORDER BY occurred_at')).rows;

  test('the consumer drains the Pg outbox (regression: fetchPending was missing)', async () => {
    await enqueue(event(1), event(2));
    const seen = [];
    const consumer = new OutboxConsumer({ outboxPort: outbox, deliverEventCommand: { execute: async (e) => { seen.push(e); return ok; } } });
    expect(await consumer.tick()).toBe(2);
    expect(seen.map((e) => e.eventId)).toEqual([uuid(1), uuid(2)]); // domain event ids, in order
    expect(seen[0]).toEqual(expect.objectContaining({ type: 'test.happened', aggregateType: 'Test', payload: { n: 1 } }));
    expect((await rows()).map((r) => r.status)).toEqual(['dispatched', 'dispatched']);
    expect(await consumer.tick()).toBe(0);
  });

  test('a failed delivery is retried after backoff, not lost', async () => {
    await enqueue(event(3));
    let calls = 0;
    const consumer = new OutboxConsumer({
      outboxPort: outbox,
      deliverEventCommand: { execute: async () => (++calls === 1 ? fail('webhook 503') : ok) },
    });
    await consumer.tick();
    let [r] = await rows();
    expect(r).toEqual(expect.objectContaining({ status: 'pending', retry_count: 1, last_error: 'webhook 503', locked_until: null }));
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
    // Not eligible until the backoff elapses; force it due, then it delivers.
    await pg.pool.query("UPDATE outbox SET next_attempt_at = NOW() - interval '1 second'");
    await consumer.tick();
    [r] = await rows();
    expect(r.status).toBe('dispatched');
    expect(calls).toBe(2);
  });

  test('backoff is exponential with full jitter and capped', async () => {
    await enqueue(event(4));
    const [{ id }] = (await pg.pool.query('SELECT id FROM outbox')).rows;
    const delays = [];
    for (let i = 0; i < 5; i++) {
      await outbox.markFailed(id, 'x', { random: () => 1, baseDelayMs: 1000, maxDelayMs: 5000, maxAttempts: 99 });
      const { rows: [r] } = await pg.pool.query('SELECT EXTRACT(EPOCH FROM (next_attempt_at - NOW())) * 1000 AS ms FROM outbox');
      delays.push(Math.round(Number(r.ms) / 1000));
    }
    expect(delays).toEqual([1, 2, 4, 5, 5]); // seconds: 1s,2s,4s, then capped at 5s
    await outbox.markFailed(id, 'x', { random: () => 0, maxAttempts: 99 });
    const { rows: [z] } = await pg.pool.query('SELECT EXTRACT(EPOCH FROM (next_attempt_at - NOW())) * 1000 AS ms FROM outbox');
    expect(Math.abs(Number(z.ms))).toBeLessThan(1000); // jitter 0 → immediate
  });

  test('after maxAttempts the event is dead-lettered and never picked again', async () => {
    await enqueue(event(5));
    const [{ id }] = (await pg.pool.query('SELECT id FROM outbox')).rows;
    expect(await outbox.markFailed(id, 'e1', { maxAttempts: 2, random: () => 0 })).toEqual({ status: 'pending', attempts: 1 });
    expect(await outbox.markFailed(id, 'e2', { maxAttempts: 2, random: () => 0 })).toEqual({ status: 'dead_letter', attempts: 2 });
    expect(await outbox.fetchPending({ batchSize: 10 })).toEqual([]);
    expect(await outbox.getPendingCount()).toBe(0);
  });

  test('two concurrent consumers claim disjoint rows (SKIP LOCKED + lease)', async () => {
    await enqueue(...Array.from({ length: 20 }, (_, i) => event(100 + i)));
    const [a, b] = await Promise.all([
      createPgOutboxRepository(pg.pool).fetchPending({ batchSize: 12 }),
      createPgOutboxRepository(pg.pool).fetchPending({ batchSize: 12 }),
    ]);
    const ids = [...a, ...b].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);
    expect(await outbox.fetchPending({ batchSize: 50 })).toEqual([]); // all leased
  });

  test('a crashed consumer\'s lease expires and the row is reclaimed', async () => {
    await enqueue(event(7));
    const [first] = await outbox.fetchPending({ batchSize: 1, leaseMs: 50 });
    expect(await outbox.fetchPending({ batchSize: 1 })).toEqual([]);
    await new Promise((r) => setTimeout(r, 120));
    const [again] = await outbox.fetchPending({ batchSize: 1 });
    expect(again.id).toBe(first.id);
  });
});
