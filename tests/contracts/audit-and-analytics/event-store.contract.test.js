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

async function seedPg(pool, events) {
  for (const e of events) {
    await pool.query(
      `INSERT INTO events (id, type, version, aggregate_type, aggregate_id, payload, occurred_at)
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
});
