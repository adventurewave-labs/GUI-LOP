/**
 * TokenBlacklist contract suite.
 *
 * Asserts the same behaviour for the in-memory and Redis adapters:
 *   - `isBlacklisted` returns false for an unknown JTI.
 *   - After `blacklist(jti, ttl)` the JTI is reported as blacklisted.
 *   - Calling `blacklist` again is idempotent (no error, still
 *     blacklisted).
 *   - On Redis the TTL expires naturally; on in-memory the TTL is
 *     simulated through an injected clock.
 *
 * The Redis test waits one extra second past the TTL to allow the
 * Redis EXPIRE pass to run. The TTL is set to 2 s for that test.
 */

import { describeIfDocker } from '../_helpers/docker-available.js';
import { startRedis } from '../_fixtures/redis.js';
import { InMemoryTokenBlacklist } from '../../../src/backend/contexts/identity-and-access/infrastructure/cache/inmemory-token-blacklist.js';
import { RedisTokenBlacklist } from '../../../src/backend/contexts/identity-and-access/infrastructure/cache/redis-token-blacklist.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describeIfDocker('TokenBlacklist contract', () => {
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
    let now = 1_000_000_000_000;
    const clock = () => now;
    let bl;
    beforeEach(() => {
      now = 1_000_000_000_000;
      bl = new InMemoryTokenBlacklist({ now: clock });
    });

    test('unknown jti is not blacklisted', async () => {
      expect(await bl.isBlacklisted('unknown')).toBe(false);
    });

    test('blacklist then isBlacklisted returns true', async () => {
      await bl.blacklist('jti-1', 60);
      expect(await bl.isBlacklisted('jti-1')).toBe(true);
    });

    test('blacklist is idempotent', async () => {
      await bl.blacklist('jti-2', 60);
      await bl.blacklist('jti-2', 60);
      expect(await bl.isBlacklisted('jti-2')).toBe(true);
    });

    test('expires after TTL', async () => {
      await bl.blacklist('jti-3', 1);     // 1 second TTL
      expect(await bl.isBlacklisted('jti-3')).toBe(true);
      now += 2_000;                       // advance clock 2s
      expect(await bl.isBlacklisted('jti-3')).toBe(false);
    });
  });

  describe('redis adapter', () => {
    let bl;
    beforeEach(() => {
      // Use the existing connected client from the fixture.
      bl = new RedisTokenBlacklist(redis.client, { keyPrefix: 'test:bl:' });
    });

    test('unknown jti is not blacklisted', async () => {
      expect(await bl.isBlacklisted('unknown')).toBe(false);
    });

    test('blacklist then isBlacklisted returns true', async () => {
      await bl.blacklist('jti-r-1', 60);
      expect(await bl.isBlacklisted('jti-r-1')).toBe(true);
    });

    test('blacklist is idempotent', async () => {
      await bl.blacklist('jti-r-2', 60);
      await bl.blacklist('jti-r-2', 60);
      expect(await bl.isBlacklisted('jti-r-2')).toBe(true);
    });

    test('TTL expires naturally', async () => {
      await bl.blacklist('jti-r-3', 1);
      expect(await bl.isBlacklisted('jti-r-3')).toBe(true);
      // Redis EXPIRE has ~1 s granularity; wait a comfortable margin.
      await sleep(1_300);
      expect(await bl.isBlacklisted('jti-r-3')).toBe(false);
    }, 10_000);
  });
});
