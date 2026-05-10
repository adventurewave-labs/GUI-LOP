import { createPgUnitOfWork } from '../pg-unit-of-work.js';

function makeFakePool({ failQuery, failConnect } = {}) {
  const queries = [];
  const released = { count: 0 };
  const client = {
    query: jest.fn(async (sql) => {
      queries.push(sql);
      if (failQuery && sql === failQuery) throw new Error('query failed');
      return { rows: [] };
    }),
    release: jest.fn(() => {
      released.count++;
    }),
  };
  const pool = {
    connect: jest.fn(async () => {
      if (failConnect) throw new Error('connect failed');
      return client;
    }),
  };
  return { pool, client, queries, released };
}

describe('createPgUnitOfWork', () => {
  test('rejects bad pool', () => {
    expect(() => createPgUnitOfWork(null)).toThrow(TypeError);
    expect(() => createPgUnitOfWork({})).toThrow(TypeError);
  });

  test('runs callback inside BEGIN/COMMIT and releases client', async () => {
    const { pool, queries, released } = makeFakePool();
    const uow = createPgUnitOfWork(pool);
    const result = await uow.run(async ({ client }) => {
      await client.query('SELECT 1');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(queries).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(released.count).toBe(1);
  });

  test('rolls back when callback throws', async () => {
    const { pool, queries, released } = makeFakePool();
    const uow = createPgUnitOfWork(pool);
    await expect(
      uow.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(released.count).toBe(1);
  });

  test('rejects non-function callback', async () => {
    const { pool } = makeFakePool();
    const uow = createPgUnitOfWork(pool);
    await expect(uow.run('not a fn')).rejects.toThrow(TypeError);
  });

  test('original error wins even if rollback fails', async () => {
    const { pool, client } = makeFakePool();
    const uow = createPgUnitOfWork(pool);
    client.query.mockImplementation(async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('rollback exploded');
      if (sql === 'BEGIN') return {};
      throw new Error('original');
    });
    await expect(
      uow.run(async ({ client: c }) => {
        await c.query('SELECT 1');
      }),
    ).rejects.toThrow('original');
  });
});
