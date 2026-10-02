/**
 * Audit trail on Postgres (roadmap P11): the adapters' SQL, the integrity
 * endpoint's status mapping. The chain itself (trigger, tamper detection,
 * concurrency) is proven against a real Postgres in
 * tests/contracts/audit-and-analytics/event-store.contract.test.js.
 */
import express from 'express';
import request from 'supertest';
import { PgEventStore } from '../../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/pg-event-store.js';
import { PgAuditLogStore } from '../../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/pg-audit-log-store.js';
import { InMemoryEventStore } from '../../../../src/backend/contexts/audit-and-analytics/infrastructure/persistence/inmemory-event-store.js';
import { EventStore } from '../../../../src/backend/contexts/audit-and-analytics/application/ports/event-store.js';
import { createAuditRouter } from '../../../../src/backend/contexts/audit-and-analytics/interfaces/http/audit-router.js';

const fakePool = (reply) => {
  const calls = [];
  return { calls, query: async (sql, args) => { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), args }); return typeof reply === 'function' ? reply(sql, args) : reply; } };
};
const pgError = (code) => Object.assign(new Error(code), { code });

describe('PgEventStore', () => {
  test('reads audit_events, never the legacy events table', async () => {
    const pool = fakePool({ rows: [{ id: 'e1', type: 't', seq: '7', hash: 'h' }] });
    const rows = await new PgEventStore(pool).query();
    expect(pool.calls[0].sql).toMatch(/FROM audit_events ORDER BY occurred_at ASC, seq ASC LIMIT 1000 OFFSET 0$/);
    expect(pool.calls[0].sql).not.toMatch(/FROM events/);
    expect(pool.calls[0].args).toEqual([]);
    expect(rows).toEqual([{ id: 'e1', type: 't', seq: 7, hash: 'h' }]); // bigint → number
  });

  test('every filter is a bound parameter', async () => {
    const pool = fakePool({ rows: [] });
    await new PgEventStore(pool).query({ aggregateType: 'Workflow', aggregateId: 42, actorId: 'u1', range: { from: 'a', to: 'b', limit: 10, offset: 5 } });
    expect(pool.calls[0].sql).toMatch(/WHERE aggregate_type = \$1 AND aggregate_id = \$2 AND actor_id = \$3 AND occurred_at >= \$4 AND occurred_at <= \$5 ORDER BY .* LIMIT 10 OFFSET 5$/);
    expect(pool.calls[0].args).toEqual(['Workflow', '42', 'u1', 'a', 'b']);
  });

  test.each([
    [{ limit: 999999 }, 'LIMIT 5000 OFFSET 0'],
    [{ limit: -5, offset: -9 }, 'LIMIT 0 OFFSET 0'],
    [{ limit: '1; DROP TABLE users', offset: 'x' }, 'LIMIT 0 OFFSET 0'],
    [{ limit: 0 }, 'LIMIT 0 OFFSET 0'],
  ])('paging %p is clamped to numbers (%s)', async (range, expected) => {
    const pool = fakePool({ rows: [] });
    await new PgEventStore(pool).query({ range });
    expect(pool.calls[0].sql.endsWith(expected)).toBe(true);
  });

  test('a database without the table yields no entries; any other error propagates', async () => {
    expect(await new PgEventStore(fakePool(() => { throw pgError('42P01'); })).query()).toEqual([]);
    await expect(new PgEventStore(fakePool(() => { throw pgError('57014'); })).query()).rejects.toThrow('57014');
  });

  test('verifyChain maps intact, broken and empty chains', async () => {
    const at = '2026-10-01T10:00:00.000Z';
    const intact = await new PgEventStore(fakePool({ rows: [{ broken: null, entries: '12', head: { seq: 12, hash: 'abc', recorded_at: at } }] })).verifyChain();
    expect(intact).toEqual({ supported: true, ok: true, entries: 12, firstBrokenSeq: null, head: { seq: 12, hash: 'abc', recordedAt: at } });
    const broken = await new PgEventStore(fakePool({ rows: [{ broken: '3', entries: '12', head: { seq: 12, hash: 'abc', recorded_at: at } }] })).verifyChain();
    expect(broken).toMatchObject({ ok: false, firstBrokenSeq: 3 });
    const empty = await new PgEventStore(fakePool({ rows: [{ broken: null, entries: '0', head: null }] })).verifyChain();
    expect(empty).toEqual({ supported: true, ok: true, entries: 0, firstBrokenSeq: null, head: null });
  });
});

describe('PgAuditLogStore', () => {
  test.each(['42P01', '42703'])('a missing or legacy-shaped audit_logs (%s) yields no entries', async (code) => {
    expect(await new PgAuditLogStore(fakePool(() => { throw pgError(code); })).query({ aggregateType: 'Workflow' })).toEqual([]);
  });
  test('other errors propagate', async () => {
    await expect(new PgAuditLogStore(fakePool(() => { throw pgError('08006'); })).query()).rejects.toThrow('08006');
  });
});

describe('EventStore port and in-memory adapter', () => {
  test('the port is abstract', async () => {
    await expect(new EventStore().query()).rejects.toThrow(/abstract/);
    await expect(new EventStore().verifyChain()).rejects.toThrow(/abstract/);
  });
  test('in-memory has no chain and never claims integrity', async () => {
    expect(await new InMemoryEventStore([{ id: 1 }]).verifyChain()).toEqual({ supported: false, ok: false, entries: 1, firstBrokenSeq: null, head: null });
  });
});

describe('GET /audit/integrity', () => {
  const appWith = (verifyChain) => {
    const app = express();
    app.use(createAuditRouter({ getWorkflowTrailQuery: {}, getAuditTrailQuery: {}, exportComplianceDataCommand: {}, eventStore: { verifyChain } }));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
    return request(app);
  };
  test.each([
    [{ supported: true, ok: true, entries: 3, firstBrokenSeq: null, head: { seq: 3, hash: 'h' } }, 200],
    [{ supported: true, ok: false, entries: 3, firstBrokenSeq: 2, head: { seq: 3, hash: 'h' } }, 409],
    [{ supported: false, ok: false, entries: 0, firstBrokenSeq: null, head: null }, 501],
  ])('%p → %i', async (result, status) => {
    const res = await appWith(async () => result).get('/audit/integrity');
    expect(res.status).toBe(status);
    expect(res.body).toEqual(result);
  });
  test('a database failure is an error, not "intact"', async () => {
    expect((await appWith(async () => { throw new Error('db down'); }).get('/audit/integrity')).status).toBe(500);
  });
});
