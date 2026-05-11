/**
 * SubscriptionRepository contract suite.
 *
 * Asserts:
 *   - `save` + `findById` round-trips a subscription, including the
 *     JSON `filter` payload (a non-trivial VO with arrays).
 *   - `findActive` filters on `is_active = true`.
 *   - `findBySubscriber(kind, ref)` indexed lookup matches.
 *   - `delete(id)` clears the row.
 *   - The Filter VO is reconstructed identically after round-trip
 *     so the broker can apply it without any drift.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startPostgres } from '../_fixtures/postgres.js';
import { InMemorySubscriptionRepository } from '../../../src/backend/contexts/notification/infrastructure/persistence/inmemory-subscription-repository.js';
import { PgSubscriptionRepository } from '../../../src/backend/contexts/notification/infrastructure/persistence/pg-subscription-repository.js';
import { Subscription } from '../../../src/backend/contexts/notification/domain/subscription/subscription.js';

const NOW = '2026-05-10T10:00:00.000Z';

function buildWebhookSub({ id = '88888888-8888-8888-8888-888888888888' } = {}) {
  return Subscription.create({
    id,
    subscriberKind: 'webhook',
    subscriberRef: 'webhook-1',
    channel: 'webhook',
    address: 'https://hooks.example.com/incoming',
    filter: {
      eventTypes: ['workflow.completed', 'workflow.failed'],
      workflowIds: ['wf-1', 'wf-2'],
    },
    now: NOW,
  });
}

function buildWsSub({ id = '88888888-8888-8888-8888-888888888889' } = {}) {
  return Subscription.create({
    id,
    subscriberKind: 'user',
    subscriberRef: 'user-1',
    channel: 'websocket',
    address: 'ws-conn-123',
    filter: {},
    now: NOW,
  });
}

describeIfDocker('SubscriptionRepository contract', () => {
  let pg;
  const make = {
    'in-memory': () => new InMemorySubscriptionRepository(),
    'postgres': () => null,
  };

  beforeAll(async () => {
    pg = await startPostgres();
    make.postgres = () => new PgSubscriptionRepository(pg.pool);
  }, 90_000);

  afterAll(async () => {
    if (pg) await pg.cleanup();
  });

  beforeEach(async () => {
    if (pg) await pg.truncate();
  });

  describe.each([
    ['in-memory'],
    ['postgres'],
  ])('%s adapter', (label) => {
    let repo;

    beforeEach(() => {
      repo = make[label]();
    });

    test('save then findById round-trips a subscription with a filter', async () => {
      const sub = buildWebhookSub();
      await repo.save(sub);
      const found = await repo.findById(sub.id);
      expect(found).not.toBeNull();
      expect(found.subscriberRef).toBe('webhook-1');
      expect(found.channel.value).toBe('webhook');
      expect(found.address.value).toBe('https://hooks.example.com/incoming');
      expect(found.filter.toJSON()).toEqual({
        eventTypes: ['workflow.completed', 'workflow.failed'],
        workflowIds: ['wf-1', 'wf-2'],
      });
      expect(found.isActive).toBe(true);
    });

    test('findActive excludes deactivated subscriptions', async () => {
      const active = buildWebhookSub();
      const inactive = buildWsSub().deactivate();
      await repo.save(active);
      await repo.save(inactive);
      const found = await repo.findActive();
      const ids = found.map((s) => s.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(inactive.id);
    });

    test('findBySubscriber filters by (kind, ref)', async () => {
      await repo.save(buildWebhookSub());
      await repo.save(buildWsSub());
      const webhooks = await repo.findBySubscriber('webhook', 'webhook-1');
      const users = await repo.findBySubscriber('user', 'user-1');
      const nothing = await repo.findBySubscriber('user', 'no-such-user');
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].channel.value).toBe('webhook');
      expect(users).toHaveLength(1);
      expect(users[0].channel.value).toBe('websocket');
      expect(nothing).toHaveLength(0);
    });

    test('delete removes the row', async () => {
      const sub = buildWebhookSub();
      await repo.save(sub);
      await repo.delete(sub.id);
      expect(await repo.findById(sub.id)).toBeNull();
    });

    test('empty filter round-trips as { eventTypes: [], workflowIds: [] }', async () => {
      const sub = buildWsSub();
      await repo.save(sub);
      const found = await repo.findById(sub.id);
      expect(found.filter.toJSON()).toEqual({ eventTypes: [], workflowIds: [] });
      expect(found.filter.isEmpty()).toBe(true);
    });
  });
});
