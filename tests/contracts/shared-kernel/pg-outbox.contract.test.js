/**
 * Outbox contract suite.
 *
 * Verifies the shared-kernel Outbox port under both the in-memory
 * adapter (`InMemoryOutbox`) and the Postgres adapter
 * (`createPgOutboxRepository`). Tests:
 *
 *   - `enqueue([events], { client })` writes one row per event
 *     transactionally inside the caller's UoW; rerunning with the
 *     same eventId is a no-op (`ON CONFLICT (event_id) DO NOTHING`).
 *   - `pickBatch(size)` claims up to `size` pending rows. In
 *     Postgres this is `FOR UPDATE SKIP LOCKED`.
 *   - `markDispatched(ids)` flips the rows to `dispatched`.
 *   - `markFailed(id, reason)` bumps `retry_count` and stores the
 *     truncated reason.
 *   - `getOldestPendingAge(now)` returns ms; 0 when nothing pending.
 *   - `getPendingCount()` returns the pending row count.
 *
 * Concurrency test (Postgres only): 4 simulated workers each call
 * `pickBatch(50)` inside their own transaction over 1000 enqueued
 * events; we assert (a) no event is claimed by more than one worker
 * and (b) every event ends marked `dispatched`.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryOutbox } from '../../../src/backend/shared-kernel/infrastructure/inmemory-outbox.js';
import { createPgOutboxRepository } from '../../../src/backend/shared-kernel/infrastructure/pg-outbox-repository.js';
import { randomUUID } from 'node:crypto';

const FIXED_NOW = new Date('2026-05-10T10:00:00.000Z');

function event({ id = randomUUID(), type = 'workflow.created', occurredAt = FIXED_NOW.toISOString(), aggregateId } = {}) {
  return {
    eventId: id,
    eventType: type,
    eventVersion: 1,
    aggregateId: aggregateId ?? randomUUID(),
    aggregateType: 'Workflow',
    payload: { hello: 'world' },
    occurredAt,
    correlationId: null,
    causationId: null,
  };
}

describeIfDocker('Outbox contract', () => {
  let pg;

  beforeAll(async () => {
    pg = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (pg) await pg.cleanup();
  });

  beforeEach(async () => {
    if (pg) await pg.truncate();
  });

  describe('in-memory adapter', () => {
    let outbox;
    beforeEach(() => { outbox = new InMemoryOutbox(); });

    test('enqueue then pickBatch returns pending rows', async () => {
      await outbox.enqueue([event(), event()]);
      const batch = await outbox.pickBatch(10);
      expect(batch).toHaveLength(2);
      expect(batch[0].status).toBe('pending');
    });

    test('markDispatched flips status to dispatched', async () => {
      await outbox.enqueue([event()]);
      const [{ id }] = await outbox.pickBatch(1);
      await outbox.markDispatched([id]);
      const remaining = await outbox.pickBatch(10);
      expect(remaining).toHaveLength(0);
      expect(await outbox.getPendingCount()).toBe(0);
    });

    test('markFailed bumps retry_count and keeps row pending', async () => {
      await outbox.enqueue([event()]);
      const [{ id }] = await outbox.pickBatch(1);
      await outbox.markFailed(id, 'transient');
      const after = await outbox.pickBatch(10);
      expect(after).toHaveLength(1);
      expect(after[0].retry_count).toBe(1);
    });

    test('getOldestPendingAge: 0 when empty, > 0 when populated', async () => {
      expect(await outbox.getOldestPendingAge()).toBe(0);
      await outbox.enqueue([event({ occurredAt: new Date(FIXED_NOW.getTime() - 5_000).toISOString() })]);
      const age = await outbox.getOldestPendingAge(FIXED_NOW);
      expect(age).toBeGreaterThanOrEqual(4_000);
    });
  });

  describe('postgres adapter', () => {
    let outbox;
    beforeEach(() => { outbox = createPgOutboxRepository(pg.pool); });

    test('enqueue writes a row, pickBatch claims it', async () => {
      const ev = event();
      const client = await pg.pool.connect();
      try {
        await client.query('BEGIN');
        await outbox.enqueue([ev], { client });
        await client.query('COMMIT');
      } finally { client.release(); }

      const batch = await outbox.pickBatch(10);
      expect(batch).toHaveLength(1);
      expect(batch[0].event_id).toBe(ev.eventId);
    });

    test('enqueue is idempotent on duplicate event_id', async () => {
      const ev = event();
      const client = await pg.pool.connect();
      try {
        await client.query('BEGIN');
        await outbox.enqueue([ev, ev], { client });
        await client.query('COMMIT');
      } finally { client.release(); }

      const batch = await outbox.pickBatch(10);
      expect(batch).toHaveLength(1);
    });

    test('markDispatched + getPendingCount agree', async () => {
      const ev = event();
      const client = await pg.pool.connect();
      try {
        await client.query('BEGIN');
        await outbox.enqueue([ev], { client });
        await client.query('COMMIT');
      } finally { client.release(); }

      const batch = await outbox.pickBatch(10);
      await outbox.markDispatched(batch.map((r) => r.id));
      expect(await outbox.getPendingCount()).toBe(0);
    });

    test('markFailed bumps retry_count and stores reason', async () => {
      const ev = event();
      const client = await pg.pool.connect();
      try {
        await client.query('BEGIN');
        await outbox.enqueue([ev], { client });
        await client.query('COMMIT');
      } finally { client.release(); }

      const batch = await outbox.pickBatch(10);
      await outbox.markFailed(batch[0].id, 'kaboom');
      const { rows } = await pg.pool.query(
        'SELECT retry_count, last_error, status FROM outbox WHERE id = $1',
        [batch[0].id],
      );
      expect(rows[0].retry_count).toBe(1);
      expect(rows[0].last_error).toBe('kaboom');
      expect(rows[0].status).toBe('failed');
    });

    test('getOldestPendingAge returns ms', async () => {
      const ev = event({ occurredAt: new Date(FIXED_NOW.getTime() - 10_000).toISOString() });
      const client = await pg.pool.connect();
      try {
        await client.query('BEGIN');
        await outbox.enqueue([ev], { client });
        await client.query('COMMIT');
      } finally { client.release(); }

      const age = await outbox.getOldestPendingAge(FIXED_NOW);
      expect(age).toBeGreaterThanOrEqual(9_000);
    });

    test('concurrent pickBatch claims via FOR UPDATE SKIP LOCKED — no double-claim', async () => {
      // Seed 1000 events.
      const enqClient = await pg.pool.connect();
      try {
        await enqClient.query('BEGIN');
        const events = Array.from({ length: 1000 }, () => event());
        // Enqueue in chunks of 100 to keep the txn lean.
        for (let i = 0; i < events.length; i += 100) {
          await outbox.enqueue(events.slice(i, i + 100), { client: enqClient });
        }
        await enqClient.query('COMMIT');
      } finally { enqClient.release(); }

      // 4 workers, each pulling repeatedly until the queue drains.
      const seen = new Map();          // id -> count of workers that claimed it
      const dispatchedByWorker = [];

      async function worker(_n) {
        const claimedIds = [];
        for (;;) {
          const client = await pg.pool.connect();
          try {
            await client.query('BEGIN');
            const batch = await outbox.pickBatch(50, { client });
            if (batch.length === 0) {
              await client.query('COMMIT');
              break;
            }
            const ids = batch.map((r) => r.id);
            for (const id of ids) {
              seen.set(id, (seen.get(id) ?? 0) + 1);
            }
            // mark dispatched within the same txn so the rows leave the
            // pending pool atomically with the claim.
            await client.query(
              `UPDATE outbox SET status = 'dispatched', dispatched_at = NOW()
                WHERE id = ANY($1::uuid[])`,
              [ids],
            );
            await client.query('COMMIT');
            claimedIds.push(...ids);
          } catch (err) {
            try { await client.query('ROLLBACK'); } catch { /* swallow */ }
            throw err;
          } finally { client.release(); }
        }
        return claimedIds;
      }

      const results = await Promise.all([worker(0), worker(1), worker(2), worker(3)]);
      for (const r of results) dispatchedByWorker.push(r.length);

      // Every event was claimed by exactly one worker.
      let doubleClaim = 0;
      for (const n of seen.values()) if (n > 1) doubleClaim += 1;
      expect(doubleClaim).toBe(0);
      expect(seen.size).toBe(1000);
      // The four workers together drained the queue.
      expect(await outbox.getPendingCount()).toBe(0);
      // Each worker pulled some events (load balanced via SKIP LOCKED).
      // We don't assert equal distribution because the loop is racey,
      // but no worker should have pulled all of them.
      for (const count of dispatchedByWorker) {
        expect(count).toBeLessThan(1000);
      }
    }, 60_000);
  });
});
