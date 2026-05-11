/**
 * Per-suite Redis testcontainer fixture.
 *
 * Boots a Redis 7 container and returns one or two ioredis-compatible
 * clients ready to use. For pub/sub-style tests we ship `getPub()` and
 * `getSub()` because Redis requires a separate connection in
 * subscriber mode.
 */

export const REDIS_IMAGE = 'redis:7-alpine';

export async function startRedis(opts = {}) {
  const tcMod = await import('@testcontainers/redis');
  const ioMod = await import('ioredis');
  const RedisContainer = tcMod.RedisContainer;
  const Redis = ioMod.default ?? ioMod;

  const image = opts.image ?? REDIS_IMAGE;
  const container = await new RedisContainer(image).start();
  const port = container.getMappedPort(6379);
  const host = container.getHost();
  const url = `redis://${host}:${port}`;

  const client = new Redis({ host, port, lazyConnect: false });
  const pub = new Redis({ host, port, lazyConnect: false });
  const sub = new Redis({ host, port, lazyConnect: false });

  await client.ping();
  await pub.ping();
  await sub.ping();

  let stopped = false;
  return {
    container,
    url,
    host,
    port,
    client,
    pub,
    sub,
    getClient: () => client,
    getRedis: () => client,
    getPub: () => pub,
    getSub: () => sub,
    async flush() {
      await client.flushall();
    },
    async cleanup() {
      if (stopped) return;
      stopped = true;
      for (const c of [client, pub, sub]) {
        try { await c.quit(); } catch { /* swallow */ }
      }
      try { await container.stop({ timeout: 5_000 }); } catch { /* swallow */ }
    },
  };
}
