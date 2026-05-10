import { createPgOutboxRepository } from '../pg-outbox-repository.js';

function makePool() {
  return {
    query: jest.fn(async () => ({ rows: [{ id: 'row-1' }] })),
    connect: jest.fn(),
  };
}

describe('createPgOutboxRepository', () => {
  test('rejects bad pool', () => {
    expect(() => createPgOutboxRepository(null)).toThrow(TypeError);
    expect(() => createPgOutboxRepository({})).toThrow(TypeError);
  });

  test('enqueue writes events through the uow client', async () => {
    const pool = makePool();
    const repo = createPgOutboxRepository(pool);
    const client = { query: jest.fn(async () => ({ rows: [] })) };
    const event = {
      eventId: 'e1',
      eventType: 'X',
      eventVersion: 1,
      aggregateId: 'a1',
      aggregateType: 'A',
      payload: { k: 'v' },
      occurredAt: '2026-05-10T00:00:00.000Z',
      correlationId: 'c1',
    };
    await repo.enqueue([event], { client });
    expect(client.query).toHaveBeenCalledTimes(1);
    const [, params] = client.query.mock.calls[0];
    expect(params[0]).toBe('e1');
    expect(params[1]).toBe('X');
    expect(params[5]).toEqual({ k: 'v' });
  });

  test('enqueue calls toJSON on event objects when present', async () => {
    const pool = makePool();
    const repo = createPgOutboxRepository(pool);
    const client = { query: jest.fn(async () => ({})) };
    const ev = {
      toJSON: () => ({
        eventId: 'e2',
        eventType: 'Y',
        eventVersion: 2,
        payload: {},
        occurredAt: '2026-05-10T00:00:00.000Z',
      }),
    };
    await repo.enqueue([ev], { client });
    expect(client.query.mock.calls[0][1][0]).toBe('e2');
    expect(client.query.mock.calls[0][1][2]).toBe(2);
  });

  test('enqueue rejects bad inputs', async () => {
    const repo = createPgOutboxRepository(makePool());
    await expect(repo.enqueue('not array', { client: {} })).rejects.toThrow(TypeError);
    await expect(repo.enqueue([], null)).rejects.toThrow(TypeError);
  });

  test('pickBatch uses FOR UPDATE SKIP LOCKED LIMIT', async () => {
    const pool = makePool();
    const repo = createPgOutboxRepository(pool);
    const rows = await repo.pickBatch(10);
    expect(rows).toEqual([{ id: 'row-1' }]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/LIMIT \$1/);
    expect(params).toEqual([10]);
  });

  test('pickBatch uses uow client when provided', async () => {
    const pool = makePool();
    const repo = createPgOutboxRepository(pool);
    const client = { query: jest.fn(async () => ({ rows: [{ id: 'x' }] })) };
    await repo.pickBatch(5, { client });
    expect(client.query).toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('pickBatch rejects bad size', async () => {
    const repo = createPgOutboxRepository(makePool());
    await expect(repo.pickBatch(0)).rejects.toThrow(TypeError);
    await expect(repo.pickBatch(-1)).rejects.toThrow(TypeError);
    await expect(repo.pickBatch(1.5)).rejects.toThrow(TypeError);
  });

  test('markDispatched issues a single UPDATE for the batch', async () => {
    const pool = makePool();
    const repo = createPgOutboxRepository(pool);
    await repo.markDispatched(['a', 'b']);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/dispatched/);
    expect(params).toEqual([['a', 'b']]);
  });

  test('markDispatched no-ops on empty array', async () => {
    const pool = makePool();
    const repo = createPgOutboxRepository(pool);
    await repo.markDispatched([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('markFailed updates with truncated reason', async () => {
    const pool = makePool();
    const repo = createPgOutboxRepository(pool);
    await repo.markFailed('id-1', 'r'.repeat(5000));
    const [, params] = pool.query.mock.calls[0];
    expect(params[0]).toBe('id-1');
    expect(params[1].length).toBe(4000);
  });

  test('markFailed rejects bad id', async () => {
    const repo = createPgOutboxRepository(makePool());
    await expect(repo.markFailed('', 'why')).rejects.toThrow(TypeError);
  });
});
