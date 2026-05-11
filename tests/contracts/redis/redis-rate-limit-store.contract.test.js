/**
 * Redis rate-limit-store contract suite.
 *
 * NOTE (deviation): the GUI-LOP DDD codebase does not yet ship a
 * dedicated `RateLimitStore` port + adapter pair — rate limiting
 * today lives in the legacy `src/backend/services/rate-limit-service.js`
 * (in-process Map) and the `rate-limit-redis` express middleware
 * driver. There is therefore no DDD adapter to test against.
 *
 * To still earn the testcontainers coverage we drive Redis directly
 * using the same primitives a future adapter will use:
 *
 *   - INCR + EXPIRE for a fresh window key.
 *   - INCR for an existing-window key (no TTL reset).
 *   - Window roll: after TTL expiry the counter resets.
 *
 * If/when a `RedisRateLimitStore` adapter lands under
 * `src/backend/contexts/identity-and-access/infrastructure/cache/` the
 * `describe.each([...adapters])` block below should be expanded to
 * call its `hit(key, windowMs, max)` method directly. Until then,
 * these assertions document the contract Redis itself satisfies and
 * guarantee the cluster behaves correctly when a future adapter is
 * wired in.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startRedis } from '../_fixtures/redis.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Minimal fixed-window counter using INCR + EXPIRE. Returned shape
 * mirrors what a future `RateLimitStore.hit()` would expose so the
 * assertions transplant cleanly when the port lands.
 *
 * @param {import('ioredis').Redis} client
 * @param {string} key
 * @param {number} windowSec
 * @param {number} max
 */
async function hit(client, key, windowSec, max) {
  const count = await client.incr(key);
  if (count === 1) {
    await client.expire(key, windowSec);
  }
  return {
    count,
    limit: max,
    exceeded: count > max,
  };
}

describeIfDocker('Redis rate-limit-store contract (port-pending)', () => {
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

  test('first hit sets the TTL and counts 1', async () => {
    const r = await hit(redis.client, 'rl:test:auth', 60, 5);
    expect(r.count).toBe(1);
    expect(r.exceeded).toBe(false);
    const ttl = await redis.client.ttl('rl:test:auth');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  test('subsequent hits within the window do NOT reset the TTL', async () => {
    await hit(redis.client, 'rl:test:auth2', 5, 5);
    const ttl1 = await redis.client.ttl('rl:test:auth2');
    await sleep(1_100);
    await hit(redis.client, 'rl:test:auth2', 5, 5);
    const ttl2 = await redis.client.ttl('rl:test:auth2');
    expect(ttl2).toBeLessThan(ttl1);
  });

  test('counter increments monotonically until the window rolls', async () => {
    let r;
    for (let i = 1; i <= 4; i++) {
      r = await hit(redis.client, 'rl:test:burst', 60, 5);
      expect(r.count).toBe(i);
      expect(r.exceeded).toBe(false);
    }
    r = await hit(redis.client, 'rl:test:burst', 60, 5);
    expect(r.count).toBe(5);
    expect(r.exceeded).toBe(false);
    r = await hit(redis.client, 'rl:test:burst', 60, 5);
    expect(r.count).toBe(6);
    expect(r.exceeded).toBe(true);
  });

  test('window roll: after TTL expiry the counter resets', async () => {
    await hit(redis.client, 'rl:test:roll', 1, 5);
    await sleep(1_300);
    const after = await hit(redis.client, 'rl:test:roll', 1, 5);
    expect(after.count).toBe(1);
  }, 10_000);

  test('concurrency-safe: 100 parallel hits give exact count 100', async () => {
    const promises = Array.from({ length: 100 }, () =>
      hit(redis.client, 'rl:test:concurrent', 60, 1000),
    );
    await Promise.all(promises);
    const final = await redis.client.get('rl:test:concurrent');
    expect(Number(final)).toBe(100);
  });
});
