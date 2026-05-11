/**
 * EventPublisher contract suite.
 *
 * Asserts the publish/subscribe contract for the in-memory and Redis
 * adapters:
 *   - `subscribe(channel, handler)` then `publish(channel, env)`
 *     delivers the envelope to every active handler exactly once.
 *   - Two subscribers on the same channel both receive the envelope.
 *   - The unsubscribe callback returned by `subscribe` removes the
 *     handler without affecting the others.
 *
 * For Redis we use the separate `pub` / `sub` clients provided by
 * the fixture — ioredis requires a dedicated subscriber connection.
 *
 * The Redis pub/sub semantics are at-most-once and best-effort. To
 * avoid race-flake, every assertion that expects a delivery awaits
 * a small "settle" delay after publish.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startRedis } from '../_fixtures/redis.js';
import { InMemoryEventPublisher } from '../../../src/backend/contexts/notification/infrastructure/transport/inmemory-event-publisher.js';
import { RedisEventPublisher } from '../../../src/backend/contexts/notification/infrastructure/transport/redis-event-publisher.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describeIfDocker('EventPublisher contract', () => {
  let redis;

  beforeAll(async () => {
    redis = await startRedis();
  }, 90_000);

  afterAll(async () => {
    if (redis) await redis.cleanup();
  });

  beforeEach(async () => {
    if (redis) await redis.flush();
  });

  describe('in-memory adapter', () => {
    let pub;
    beforeEach(() => { pub = new InMemoryEventPublisher(); });
    afterEach(async () => { await pub.close(); });

    test('publish delivers to every subscribed handler', async () => {
      const got = [];
      await pub.subscribe('events', (env) => { got.push(env); });
      await pub.publish('events', { type: 'X', n: 1 });
      expect(got).toEqual([{ type: 'X', n: 1 }]);
    });

    test('two handlers on the same channel both receive', async () => {
      const a = [];
      const b = [];
      await pub.subscribe('events', (env) => a.push(env));
      await pub.subscribe('events', (env) => b.push(env));
      await pub.publish('events', { type: 'Y' });
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });

    test('unsubscribe stops further deliveries', async () => {
      const a = [];
      const b = [];
      const unsubA = await pub.subscribe('events', (env) => a.push(env));
      await pub.subscribe('events', (env) => b.push(env));
      await unsubA();
      await pub.publish('events', { type: 'Z' });
      expect(a).toHaveLength(0);
      expect(b).toHaveLength(1);
    });
  });

  describe('redis adapter', () => {
    let pub;

    beforeEach(() => {
      pub = new RedisEventPublisher({
        pubClient: redis.pub,
        subClient: redis.sub,
      });
    });

    afterEach(async () => {
      // Don't close the underlying clients; the fixture owns them.
      // Just clear the in-memory handler map by recreating the publisher.
      pub._handlers.clear();
    });

    test('publish on one client delivers to a subscriber on another', async () => {
      const got = [];
      await pub.subscribe('events.test', (env) => { got.push(env); });
      await pub.publish('events.test', { type: 'A', n: 1 });
      // Pub/sub is async — give the message loop a moment.
      await sleep(150);
      expect(got).toEqual([{ type: 'A', n: 1 }]);
    });

    test('two handlers on the same channel both receive', async () => {
      const a = [];
      const b = [];
      await pub.subscribe('events.dup', (env) => a.push(env));
      await pub.subscribe('events.dup', (env) => b.push(env));
      await pub.publish('events.dup', { type: 'B' });
      await sleep(150);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });

    test('unsubscribe stops further deliveries', async () => {
      const a = [];
      const b = [];
      const unsubA = await pub.subscribe('events.unsub', (env) => a.push(env));
      await pub.subscribe('events.unsub', (env) => b.push(env));
      await unsubA();
      // Give Redis a moment to process UNSUBSCRIBE before publishing.
      await sleep(50);
      await pub.publish('events.unsub', { type: 'C' });
      await sleep(150);
      expect(a).toHaveLength(0);
      expect(b).toHaveLength(1);
    });
  });
});
