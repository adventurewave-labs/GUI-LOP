/**
 * Unit tests for the InMemoryOutbox observability surface.
 * Focused on the new `getOldestPendingAge()` and `getPendingCount()`
 * methods added for the /health probe.
 */

import { InMemoryOutbox } from '../inmemory-outbox.js';

describe('InMemoryOutbox observability surface', () => {
  test('getOldestPendingAge returns 0 on an empty outbox', async () => {
    const outbox = new InMemoryOutbox();
    expect(await outbox.getOldestPendingAge(new Date())).toBe(0);
  });

  test('getOldestPendingAge returns 0 when all rows are dispatched', async () => {
    const outbox = new InMemoryOutbox();
    await outbox.enqueue([
      makeEvent({ id: 'e1', occurredAt: '2026-05-10T11:59:59.000Z' }),
    ]);
    await outbox.markDispatched('e1');
    expect(await outbox.getOldestPendingAge(new Date('2026-05-10T12:00:00Z'))).toBe(0);
  });

  test('getOldestPendingAge returns ms since the oldest pending event', async () => {
    const outbox = new InMemoryOutbox();
    await outbox.enqueue([
      makeEvent({ id: 'e1', occurredAt: '2026-05-10T11:59:59.000Z' }),
      makeEvent({ id: 'e2', occurredAt: '2026-05-10T11:59:58.000Z' }),
      makeEvent({ id: 'e3', occurredAt: '2026-05-10T11:59:55.000Z' }),
    ]);
    const age = await outbox.getOldestPendingAge(new Date('2026-05-10T12:00:00Z'));
    expect(age).toBe(5000); // 12:00:00 - 11:59:55
  });

  test('getOldestPendingAge ignores already-dispatched rows', async () => {
    const outbox = new InMemoryOutbox();
    await outbox.enqueue([
      makeEvent({ id: 'e-old', occurredAt: '2026-05-10T11:00:00.000Z' }),
      makeEvent({ id: 'e-new', occurredAt: '2026-05-10T11:59:30.000Z' }),
    ]);
    await outbox.markDispatched('e-old');
    const age = await outbox.getOldestPendingAge(new Date('2026-05-10T12:00:00Z'));
    expect(age).toBe(30_000);
  });

  test('getPendingCount counts only pending records', async () => {
    const outbox = new InMemoryOutbox();
    expect(await outbox.getPendingCount()).toBe(0);
    await outbox.enqueue([
      makeEvent({ id: 'e1', occurredAt: '2026-05-10T11:00:00.000Z' }),
      makeEvent({ id: 'e2', occurredAt: '2026-05-10T11:00:00.000Z' }),
    ]);
    expect(await outbox.getPendingCount()).toBe(2);
    await outbox.markDispatched('e1');
    expect(await outbox.getPendingCount()).toBe(1);
  });
});

function makeEvent({ id, occurredAt }) {
  return {
    toJSON() {
      return {
        eventId: id,
        eventType: 'test.event',
        eventVersion: 1,
        aggregateId: id,
        aggregateType: 'Test',
        payload: {},
        occurredAt,
        correlationId: id,
      };
    },
  };
}
