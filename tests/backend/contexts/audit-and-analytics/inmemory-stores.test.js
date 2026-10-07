/**
 * In-memory audit-log + event stores — query semantics (roadmap 15b).
 *
 * The Pg adapters are pinned by the contract suite; these pin the in-memory
 * twins in the default gate, including the Date-vs-ISO-string range bug
 * (`new Date() >= '2026-…'` is always false, so ranged queries over rows
 * stored with Date timestamps returned nothing).
 */
import { InMemoryAuditLogStore } from '../../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/inmemory-audit-log-store.js';
import { InMemoryEventStore } from '../../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/inmemory-event-store.js';

const ids = (rows) => rows.map((r) => r.id);

describe.each([
  ['audit log', () => new InMemoryAuditLogStore(), 'created'],
  ['event store', () => new InMemoryEventStore(), 'occurred'],
])('%s (in-memory)', (_label, make, field) => {
  const snake = `${field}_at`;
  const camel = `${field}At`;
  let store;

  beforeEach(() => {
    store = make();
    // Mixed shapes on purpose: snake_case + ISO string, camelCase + Date.
    store.add({ id: 'c', aggregate_type: 'Workflow', aggregate_id: 'wf-1', actor_id: 'u1', [snake]: '2026-05-03T00:00:00.000Z' });
    store.add({ id: 'a', aggregateType: 'Workflow', aggregateId: 'wf-1', actorId: 'u2', [camel]: new Date('2026-05-01T00:00:00.000Z') });
    store.add({ id: 'b', aggregate_type: 'User', aggregate_id: 'u-9', actor_id: 'u1', [snake]: new Date('2026-05-02T00:00:00.000Z') });
  });

  test('no filter → everything, ascending by timestamp across Date and string', async () => {
    expect(ids(await store.query())).toEqual(['a', 'b', 'c']);
  });

  test('aggregateType / aggregateId match snake_case and camelCase rows', async () => {
    expect(ids(await store.query({ aggregateType: 'Workflow' }))).toEqual(['a', 'c']);
    expect(ids(await store.query({ aggregateType: 'Workflow', aggregateId: 'wf-1' }))).toEqual(['a', 'c']);
    expect(ids(await store.query({ aggregateId: 'nope' }))).toEqual([]);
  });

  test('range is inclusive and works when rows hold Date objects (regression)', async () => {
    const r = await store.query({ range: { from: '2026-05-01T00:00:00.000Z', to: '2026-05-02T00:00:00.000Z' } });
    expect(ids(r)).toEqual(['a', 'b']);
    expect(ids(await store.query({ range: { from: new Date('2026-05-02T00:00:00.000Z') } }))).toEqual(['b', 'c']);
  });

  test('limit/offset page like the Pg adapter (default 1000, cap 5000)', async () => {
    expect(ids(await store.query({ range: { limit: 2 } }))).toEqual(['a', 'b']);
    expect(ids(await store.query({ range: { limit: 2, offset: 2 } }))).toEqual(['c']);
    for (let i = 0; i < 5100; i++) store.add({ id: `x${i}`, [snake]: '2026-06-01T00:00:00.000Z' });
    expect(await store.query()).toHaveLength(1000);
    expect(await store.query({ range: { limit: 99999 } })).toHaveLength(5000);
  });

  test('add() copies the row (no aliasing)', async () => {
    const row = { id: 's', [snake]: '2026-01-01T00:00:00.000Z' };
    store.add(row);
    row.id = 'mutated';
    expect(ids(await store.query({ range: { to: '2026-01-31T00:00:00.000Z' } }))).toEqual(['s']);
  });
});

test('audit log filters by actorId (snake and camel)', async () => {
  const store = new InMemoryAuditLogStore([
    { id: '1', actor_id: 'u1', created_at: '2026-01-01T00:00:00Z' },
    { id: '2', actorId: 'u1', createdAt: new Date('2026-01-02T00:00:00Z') },
    { id: '3', actor_id: 'u2', created_at: '2026-01-03T00:00:00Z' },
  ]);
  expect(ids(await store.query({ actorId: 'u1' }))).toEqual(['1', '2']);
});
