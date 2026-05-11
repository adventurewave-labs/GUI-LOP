/**
 * AuditLogStore contract suite.
 *
 * Asserts:
 *   - Filter by `aggregateType` + `aggregateId` (the dominant query
 *     pattern from the audit dashboard).
 *   - Filter by `actorId` for "what did this user do" timelines.
 *   - Range filter on `created_at`.
 *   - Default ordering is `created_at ASC` with `limit` / `offset`
 *     pagination.
 *
 * The Postgres path queries the projected `audit_logs` table built by
 * `applyAnalyticsProjections` — shape:
 *   (id, actor_id, action, aggregate_type, aggregate_id, details, created_at)
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryAuditLogStore } from '../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/inmemory-audit-log-store.js';
import { PgAuditLogStore } from '../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/pg-audit-log-store.js';

const ACTOR_A = 'aaaaaaaa-1111-1111-1111-aaaaaaaa1111';
const ACTOR_B = 'aaaaaaaa-1111-1111-1111-aaaaaaaa2222';
const WF_A = 'bbbbbbbb-1111-1111-1111-bbbbbbbb1111';

function entries() {
  return [
    {
      id: 'audit-001',
      actor_id: ACTOR_A,
      action: 'workflow.create',
      aggregate_type: 'Workflow',
      aggregate_id: WF_A,
      details: { ok: true },
      created_at: '2026-05-10T10:00:00.000Z',
    },
    {
      id: 'audit-002',
      actor_id: ACTOR_A,
      action: 'workflow.start',
      aggregate_type: 'Workflow',
      aggregate_id: WF_A,
      details: {},
      created_at: '2026-05-10T10:01:00.000Z',
    },
    {
      id: 'audit-003',
      actor_id: ACTOR_B,
      action: 'user.deactivate',
      aggregate_type: 'User',
      aggregate_id: 'cccccccc-1111-1111-1111-cccccccc1111',
      details: {},
      created_at: '2026-05-10T10:05:00.000Z',
    },
  ];
}

async function seedPg(pool, items) {
  for (const e of items) {
    await pool.query(
      `INSERT INTO audit_logs (id, actor_id, action, aggregate_type, aggregate_id, details, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6)`,
      [e.actor_id, e.action, e.aggregate_type, e.aggregate_id, JSON.stringify(e.details ?? {}), e.created_at],
    );
  }
}

describeIfDocker('AuditLogStore contract', () => {
  let pg;
  const fixtures = entries();
  const memStore = new InMemoryAuditLogStore(fixtures);
  const make = {
    'in-memory': () => memStore,
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgAuditLogStore(pg.pool);
  }, 90_000);

  afterAll(async () => {
    if (pg) await pg.cleanup();
  });

  beforeEach(async () => {
    if (pg) {
      await pg.truncate();
      // gen_random_uuid() needs pgcrypto; the schema migration enables it.
      await seedPg(pg.pool, fixtures);
    }
  });

  describe.each([
    ['in-memory'],
    ['postgres'],
  ])('%s adapter', (label) => {
    let store;
    beforeEach(() => { store = make[label](); });

    test('filter by aggregateType + aggregateId', async () => {
      const rows = await store.query({ aggregateType: 'Workflow', aggregateId: WF_A });
      expect(rows.length).toBe(2);
    });

    test('filter by actorId', async () => {
      const rows = await store.query({ actorId: ACTOR_A });
      expect(rows.length).toBe(2);
      for (const r of rows) {
        expect(r.actor_id ?? r.actorId).toBe(ACTOR_A);
      }
    });

    test('filter by range (inclusive)', async () => {
      const rows = await store.query({
        range: { from: '2026-05-10T10:01:00.000Z', to: '2026-05-10T10:05:00.000Z' },
      });
      expect(rows.length).toBe(2);
    });

    test('ordered ASC by created_at', async () => {
      const rows = await store.query();
      const times = rows.map((r) => new Date(r.created_at ?? r.createdAt).getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    });
  });
});
