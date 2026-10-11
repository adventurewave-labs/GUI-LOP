/**
 * node-redis client contract suite (redis ^6).
 *
 * The runtime uses ioredis, but `redis` (node-redis) is a production
 * dependency exercised by tests/load/scenarios/redis-load-test.js.
 * This suite pins the client contract for that dependency against a
 * real Redis instance so major bumps (5.x -> 6.x) carry CI evidence:
 *
 *   - createClient({ url }).connect() establishes the connection
 *   - set/get round-trips a UTF-8 string
 *   - incr counts atomically from 0
 *   - expire + ttl exposes key TTL
 *   - del removes and reports the removed key count
 *
 * Runs wherever the other contract suites run: GitHub Actions service
 * container (CONTRACTS_REDIS_URL) or a local testcontainer.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startRedis } from '../_fixtures/redis.js';
import { createClient } from 'redis';

describeIfDocker('node-redis client contract (redis 6)', () => {
  let redis;
  let client;

  beforeAll(async () => {
    redis = await startRedis();
    client = createClient({ url: redis.url });
    client.on('error', () => { /* surfaced by assertions */ });
    await client.connect();
  }, 90_000);

  afterAll(async () => {
    if (client && client.isOpen) await client.quit().catch(() => {});
    if (redis) await redis.cleanup();
  });

  beforeEach(async () => {
    await redis.flush();
  });

  test('connects and pings on the v6 client', async () => {
    const pong = await client.ping();
    expect(pong).toBe('PONG');
  });

  test('set/get round-trips a UTF-8 payload', async () => {
    await client.set('smoke:key', 'Puerto Vallarta ❤');
    const value = await client.get('smoke:key');
    expect(value).toBe('Puerto Vallarta ❤');
  });

  test('incr counts atomically from zero', async () => {
    expect(await client.incr('smoke:counter')).toBe(1);
    expect(await client.incr('smoke:counter')).toBe(2);
    expect(await client.incr('smoke:counter')).toBe(3);
  });

  test('expire + ttl exposes the remaining TTL', async () => {
    await client.set('smoke:ttl', 'v');
    await client.expire('smoke:ttl', 60);
    const ttl = await client.ttl('smoke:ttl');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  test('del removes keys and reports the count', async () => {
    await client.set('smoke:gone-a', '1');
    await client.set('smoke:gone-b', '2');
    const removed = await client.del('smoke:gone-a', 'smoke:gone-b', 'smoke:never-existed');
    expect(removed).toBe(2);
    expect(await client.get('smoke:gone-a')).toBeNull();
  });
});
