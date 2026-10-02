/**
 * DeliveryAttemptRepository contract suite.
 *
 * Asserts:
 *   - `record(attempt)` is append-only.
 *   - `listForEvent(eventId)` returns rows ordered by `attempted_at`
 *     ascending (the OutboxConsumer relies on this for replay).
 *   - `countForSubscription(subscriptionId, eventId)` counts each
 *     attempt distinctly.
 *
 * Both adapters use plain-object attempt records; the Postgres
 * adapter normalises `attempted_at` to ISO strings on read so the
 * shape is identical.
 *
 * To satisfy the FK on subscription_id we seed one Subscription
 * row in the Postgres path. The in-memory adapter has no FKs.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemoryDeliveryAttemptRepository } from '../../../src/backend/contexts/notification/infrastructure/persistence/inmemory-delivery-attempt-repository.js';
import { PgDeliveryAttemptRepository } from '../../../src/backend/contexts/notification/infrastructure/persistence/pg-delivery-attempt-repository.js';
import { PgSubscriptionRepository } from '../../../src/backend/contexts/notification/infrastructure/persistence/pg-subscription-repository.js';
import { Subscription } from '../../../src/backend/contexts/notification/domain/subscription/subscription.js';

const SUB_ID = '99999999-9999-9999-9999-999999999999';
const EVENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const T1 = '2026-05-10T10:00:01.000Z';
const T2 = '2026-05-10T10:00:02.000Z';
const T3 = '2026-05-10T10:00:03.000Z';

function attempt({ id, status = 'success', n = 1, attemptedAt = T1, eventId = EVENT_ID } = {}) {
  return {
    id,
    subscriptionId: SUB_ID,
    eventId,
    attemptNumber: n,
    status,
    error: null,
    attemptedAt,
  };
}

async function seedSubscription(pool) {
  const subRepo = new PgSubscriptionRepository(pool);
  const sub = Subscription.create({
    id: SUB_ID,
    subscriberKind: 'webhook',
    subscriberRef: 'webhook-1',
    channel: 'webhook',
    address: 'https://hooks.example.com/incoming',
    filter: {},
  });
  await subRepo.save(sub);
}

describeIfDocker('DeliveryAttemptRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemoryDeliveryAttemptRepository(),
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgDeliveryAttemptRepository(pg.pool);
  }, 90_000);

  afterAll(async () => {
    if (pg) await pg.cleanup();
  });

  beforeEach(async () => {
    if (pg) {
      await pg.truncate();
      await seedSubscription(pg.pool);
    }
  });

  describe.each([
    ['in-memory'],
    ['postgres'],
  ])('%s adapter', (label) => {
    let repo;

    beforeEach(() => {
      repo = make[label]();
    });

    test('record then listForEvent returns the attempts ordered by attempted_at', async () => {
      await repo.record(attempt({ id: 'a8906abf-816c-44a6-81f3-43db848ac092' /* a-2 */, n: 2, attemptedAt: T2 }));
      await repo.record(attempt({ id: '366b7a5d-c5b9-4dd3-8035-565a63880d86' /* a-1 */, n: 1, attemptedAt: T1 }));
      await repo.record(attempt({ id: '0b07c4c4-2df9-4e4e-83f6-5e9efd99fc0a' /* a-3 */, n: 3, attemptedAt: T3 }));
      const rows = await repo.listForEvent(EVENT_ID);
      expect(rows.map((r) => r.id)).toEqual(['366b7a5d-c5b9-4dd3-8035-565a63880d86' /* a-1 */, 'a8906abf-816c-44a6-81f3-43db848ac092' /* a-2 */, '0b07c4c4-2df9-4e4e-83f6-5e9efd99fc0a' /* a-3 */]);
      expect(rows.map((r) => r.attemptNumber)).toEqual([1, 2, 3]);
    });

    test('countForSubscription is a per-(sub, event) count', async () => {
      await repo.record(attempt({ id: '42a84e8e-2dc4-4f90-858d-94e5d96edc16' /* x-1 */, n: 1, attemptedAt: T1 }));
      await repo.record(attempt({ id: 'bfbbdc0d-7018-45af-8b02-4eee82a83720' /* x-2 */, n: 2, attemptedAt: T2 }));
      await repo.record(attempt({ id: 'c1d2e3f4-0000-4000-8000-0000000000y1'.replace('y1','01'), n: 1, attemptedAt: T1, eventId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }));
      expect(await repo.countForSubscription(SUB_ID, EVENT_ID)).toBe(2);
      expect(await repo.countForSubscription(SUB_ID, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')).toBe(1);
    });

    test('append-only: re-recording with a new id is a new row', async () => {
      await repo.record(attempt({ id: '4b401584-2750-4a34-85af-0cc61a279818' /* r-1 */, n: 1, attemptedAt: T1 }));
      await repo.record(attempt({ id: 'b90ad9c3-7cd8-41c3-85f0-b1a483e1d849' /* r-1b */, n: 2, attemptedAt: T2 }));
      const rows = await repo.listForEvent(EVENT_ID);
      expect(rows.length).toBe(2);
    });
  });
});
