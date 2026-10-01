import { createPooledOutbox } from '../pooled-outbox.js';

function harness({ failOn } = {}) {
  const log = [];
  const client = {
    query: async (sql) => { log.push(sql); if (failOn === sql) throw new Error(`fail ${sql}`); },
    release: (err) => log.push(err ? 'release(err)' : 'release'),
  };
  const written = [];
  const outbox = { enqueue: async (events, ctx) => { if (failOn === 'enqueue') throw new Error('fail enqueue'); expect(ctx.client).toBe(client); written.push(...events); log.push('enqueue'); } };
  return { log, written, pool: { connect: async () => client }, outbox };
}
const ev = (eventType, payload = {}, actor = { type: 'system' }) => ({ toJSON: () => ({ eventId: 'e', eventType, payload, actor }) });

describe('createPooledOutbox', () => {
  test('writes the events in one short transaction and releases the client', async () => {
    const h = harness();
    await createPooledOutbox(h).enqueue([ev('user.authenticated', { userId: 'u1' })]);
    expect(h.log).toEqual(['BEGIN', 'enqueue', 'COMMIT', 'release']);
    expect(h.written).toEqual([{ eventId: 'e', eventType: 'user.authenticated', payload: { userId: 'u1' }, actor: { type: 'system' } }]);
  });

  test('skipped types and empty batches never touch the database', async () => {
    const h = harness();
    const ob = createPooledOutbox({ ...h, skipTypes: ['api_key.used'] });
    await ob.enqueue([ev('api_key.used')]);
    await ob.enqueue([]);
    expect(h.log).toEqual([]);
    await ob.enqueue([ev('api_key.used'), ev('api_key.revoked')]);
    expect(h.written.map((e) => e.eventType)).toEqual(['api_key.revoked']);
  });

  test('attributes administrative actions to the administrator, never to the target user', async () => {
    const h = harness();
    const ob = createPooledOutbox(h);
    await ob.enqueue([ev('permission.granted', { userId: 'target' })], { actorId: 'admin-1' });
    await ob.enqueue([ev('user.deactivated', { userId: 'target' })]);                     // actor unknown
    await ob.enqueue([ev('api_key.revoked', { userId: 'u' }, { type: 'user', id: 'u9' })]); // actor on the event
    await ob.enqueue([ev('user.authenticated', { userId: 'u' })]);                        // subject is the actor
    expect(h.written.map((e) => e.payload)).toEqual([
      { userId: 'target', actorId: 'admin-1' },
      { userId: 'target', actorId: 'system' },
      { userId: 'u', actorId: 'u9' },
      { userId: 'u' },
    ]);
  });

  test.each(['enqueue', 'COMMIT'])('a failure in %s rolls back, discards the client and is thrown', async (failOn) => {
    const h = harness({ failOn });
    await expect(createPooledOutbox(h).enqueue([ev('user.registered')])).rejects.toThrow(`fail ${failOn}`);
    expect(h.log.slice(-2)).toEqual(['ROLLBACK', 'release(err)']);
  });

  test('rejects a non-array and plain objects pass through', async () => {
    const h = harness();
    await expect(createPooledOutbox(h).enqueue(null)).rejects.toThrow(TypeError);
    await createPooledOutbox(h).enqueue([{ eventId: 'p', eventType: 'x', payload: {} }, null]);
    expect(h.written).toEqual([{ eventId: 'p', eventType: 'x', payload: {} }]);
  });
});
