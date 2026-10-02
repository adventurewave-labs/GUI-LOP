/**
 * EventStore contract suite.
 *
 * Asserts the same query semantics for the in-memory and Postgres
 * adapters:
 *   - Filter by `aggregateType`.
 *   - Filter by `aggregateId`.
 *   - Filter by `range.from` / `range.to` (inclusive bounds on
 *     `occurred_at`).
 *   - Default ordering is `occurred_at ASC`.
 *   - `limit` / `offset` paging.
 *
 * The Postgres path queries the projected `events` table created by
 * `applyAnalyticsProjections` (see `_helpers/apply-migrations.js`).
 * That schema is `(id, type, version, aggregate_type, aggregate_id,
 * payload, occurred_at)` — matching the read shape the adapter
 * expects per ADR 0017.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryEventStore } from '../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/inmemory-event-store.js';
import { PgEventStore } from '../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/pg-event-store.js';

const WF_A = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
const WF_B = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb';

// The real write path: a domain event is inserted into `outbox`; the trigger
// from migration 017 appends it to the hash-chained `audit_events` in the same
// transaction. (This suite used to insert into a hand-made `events` table
// that exists only in the test fixture.)
async function seedPg(pool, events) {
  for (const e of events) {
    await pool.query(
      `INSERT INTO outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        e.id,
        e.type,
        e.version ?? 1,
        e.aggregate_type ?? e.aggregateType ?? null,
        e.aggregate_id ?? e.aggregateId ?? null,
        JSON.stringify(e.payload ?? {}),
        e.occurred_at ?? e.occurredAt,
      ],
    );
  }
}

function eventFixtures() {
  return [
    {
      id: '11111111-2222-3333-4444-000000000001',
      type: 'workflow.created',
      aggregate_type: 'Workflow',
      aggregate_id: WF_A,
      occurred_at: '2026-05-10T10:00:00.000Z',
      payload: { wf: WF_A },
    },
    {
      id: '11111111-2222-3333-4444-000000000002',
      type: 'workflow.completed',
      aggregate_type: 'Workflow',
      aggregate_id: WF_A,
      occurred_at: '2026-05-10T10:05:00.000Z',
      payload: { wf: WF_A },
    },
    {
      id: '11111111-2222-3333-4444-000000000003',
      type: 'workflow.created',
      aggregate_type: 'Workflow',
      aggregate_id: WF_B,
      occurred_at: '2026-05-10T11:00:00.000Z',
      payload: { wf: WF_B },
    },
    {
      id: '11111111-2222-3333-4444-000000000004',
      type: 'human.response.recorded',
      aggregate_type: 'HumanResponse',
      aggregate_id: '99999999-9999-9999-9999-999999999999',
      occurred_at: '2026-05-10T11:30:00.000Z',
      payload: {},
    },
  ];
}

describeIfDocker('EventStore contract', () => {
  let pg;
  const fixtures = eventFixtures();
  const memStore = new InMemoryEventStore(fixtures);
  const make = {
    'in-memory': () => memStore,
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgEventStore(pg.pool);
  }, 90_000);

  afterAll(async () => {
    if (pg) await pg.cleanup();
  });

  beforeEach(async () => {
    if (pg) {
      await pg.truncate();
      await seedPg(pg.pool, fixtures);
    }
  });

  describe.each([
    ['in-memory'],
    ['postgres'],
  ])('%s adapter', (label) => {
    let store;
    beforeEach(() => { store = make[label](); });

    test('query with no filter returns all rows ordered by occurred_at ASC', async () => {
      const rows = await store.query();
      expect(rows.length).toBeGreaterThanOrEqual(4);
      const occurred = rows
        .map((r) => r.occurred_at ?? r.occurredAt)
        .map((v) => new Date(v).getTime());
      for (let i = 1; i < occurred.length; i++) {
        expect(occurred[i]).toBeGreaterThanOrEqual(occurred[i - 1]);
      }
    });

    test('filter by aggregateType', async () => {
      const rows = await store.query({ aggregateType: 'Workflow' });
      expect(rows.length).toBe(3);
      for (const r of rows) {
        expect(r.aggregate_type ?? r.aggregateType).toBe('Workflow');
      }
    });

    test('filter by aggregateId', async () => {
      const rows = await store.query({ aggregateType: 'Workflow', aggregateId: WF_A });
      expect(rows.length).toBe(2);
    });

    test('filter by range (inclusive)', async () => {
      const rows = await store.query({
        range: {
          from: '2026-05-10T10:05:00.000Z',
          to: '2026-05-10T11:00:00.000Z',
        },
      });
      // Events at 10:05 and 11:00 are in-range.
      expect(rows.length).toBe(2);
    });

    test('limit + offset paginates the result', async () => {
      const first = await store.query({ range: { limit: 2, offset: 0 } });
      const second = await store.query({ range: { limit: 2, offset: 2 } });
      expect(first).toHaveLength(2);
      expect(second.length).toBeGreaterThanOrEqual(1);
      expect(first[0].id).not.toBe(second[0]?.id);
    });
  });

  describe('hash chain (postgres)', () => {
    const tamper = async (sql, args) => {
      await pg.pool.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable');
      try { await pg.pool.query(sql, args); } finally {
        await pg.pool.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable');
      }
    };

    test('every outbox insert appends a linked entry; the chain verifies', async () => {
      const store = new PgEventStore(pg.pool);
      const rows = (await pg.pool.query('SELECT seq, prev_hash, hash, actor_id FROM audit_events ORDER BY seq')).rows;
      expect(rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4]);
      expect(rows[0].prev_hash).toBe('0'.repeat(64));
      for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toBe(rows[i - 1].hash);
      for (const r of rows) expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
      const v = await store.verifyChain();
      expect(v).toMatchObject({ supported: true, ok: true, entries: 4, firstBrokenSeq: null, head: { seq: 4, hash: rows[3].hash } });
    });

    test('the audit entry commits or rolls back with the business transaction', async () => {
      const client = await pg.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO outbox (event_id, event_type, payload) VALUES ('11111111-2222-3333-4444-0000000000aa', 'x.rolled_back', '{}')`);
        expect((await client.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n).toBe(5);
        await client.query('ROLLBACK');
      } finally { client.release(); }
      const v = await new PgEventStore(pg.pool).verifyChain();
      expect(v).toMatchObject({ ok: true, entries: 4, head: { seq: 4 } });
    });

    test('UPDATE, DELETE and TRUNCATE are refused', async () => {
      await expect(pg.pool.query(`UPDATE audit_events SET payload = '{"x":1}' WHERE seq = 2`)).rejects.toThrow(/append-only/);
      await expect(pg.pool.query('DELETE FROM audit_events WHERE seq = 2')).rejects.toThrow(/append-only/);
      await expect(pg.pool.query('TRUNCATE audit_events')).rejects.toThrow(/append-only/);
      expect((await new PgEventStore(pg.pool).verifyChain()).ok).toBe(true);
    });

    test.each([
      ['an edited payload', `UPDATE audit_events SET payload = '{"wf":"forged"}' WHERE seq = 2`, 2],
      ['an edited actor', `UPDATE audit_events SET actor_id = 'someone-else' WHERE seq = 3`, 3],
      ['an edited timestamp', `UPDATE audit_events SET occurred_at = occurred_at - interval '1 day' WHERE seq = 1`, 1],
      ['a row deleted from the middle', 'DELETE FROM audit_events WHERE seq = 2', 3],
      ['a forged hash on an edited row', `UPDATE audit_events SET event_type = 'forged', hash = audit_event_hash(prev_hash, seq, event_id, 'forged', event_version, aggregate_type, aggregate_id, actor_id, payload, correlation_id, occurred_at) WHERE seq = 2`, 3],
    ])('with the guard switched off, %s is detected', async (_what, sql, brokenAt) => {
      await tamper(sql);
      const v = await new PgEventStore(pg.pool).verifyChain();
      expect(v).toMatchObject({ ok: false, firstBrokenSeq: brokenAt });
    });

    test('cutting the newest entries leaves a valid chain — only a recorded head exposes it', async () => {
      const before = await new PgEventStore(pg.pool).verifyChain();
      await tamper('DELETE FROM audit_events WHERE seq = 4');
      const after = await new PgEventStore(pg.pool).verifyChain();
      expect(after.ok).toBe(true);                       // the documented limit
      expect(after.head.seq).toBeLessThan(before.head.seq); // what an external anchor catches
    });

    test('concurrent writers produce one gapless, valid chain', async () => {
      await Promise.all(Array.from({ length: 40 }, (_, i) => pg.pool.query(
        `INSERT INTO outbox (event_id, event_type, aggregate_type, aggregate_id, payload) VALUES (uuid_generate_v4(), 'load.event', 'Workflow', $1, $2::jsonb)`,
        [`wf-${i % 5}`, JSON.stringify({ i, actorId: `user-${i % 3}` })],
      )));
      const v = await new PgEventStore(pg.pool).verifyChain();
      expect(v).toMatchObject({ ok: true, entries: 44, head: { seq: 44 } });
      const mine = await new PgEventStore(pg.pool).query({ actorId: 'user-1' });
      expect(mine.length).toBe(13);
      expect((await new PgEventStore(pg.pool).query({ aggregateType: 'Workflow', aggregateId: 'wf-2' })).length).toBe(8);
    });
  });
});

