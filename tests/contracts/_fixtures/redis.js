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
  const ioMod = await import('ioredis');
  const Redis = ioMod.default ?? ioMod;

  // External-infrastructure mode (`CONTRACTS_REDIS_URL`): CI service
  // container or local server. Suites run with maxWorkers: 1 and flush
  // between tests, so a shared instance is safe.
  let container = null;
  let host;
  let port;
  if (process.env.CONTRACTS_REDIS_URL) {
    const u = new URL(process.env.CONTRACTS_REDIS_URL);
    host = u.hostname;
    port = Number(u.port || 6379);
  } else {
    const tcMod = await import('@testcontainers/redis');
    const RedisContainer = tcMod.RedisContainer;
    const image = opts.image ?? REDIS_IMAGE;
    container = await new RedisContainer(image).start();
    port = container.getMappedPort(6379);
    host = container.getHost();
  }
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
      if (container) {
        try { await container.stop({ timeout: 5_000 }); } catch { /* swallow */ }
      }
    },
  };
}
