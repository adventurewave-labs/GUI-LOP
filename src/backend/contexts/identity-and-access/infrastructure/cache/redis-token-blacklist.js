/**
 * Redis-backed TokenBlacklist. Accepts an ioredis-compatible client
 * (must expose `.set(key, value, 'EX', ttl)` and `.get(key)`).
 *
 * Keys are namespaced as `iam:bl:<jti>`.
 */
export class RedisTokenBlacklist {
  constructor(client, { keyPrefix = 'iam:bl:' } = {}) {
    if (!client) throw new Error('RedisTokenBlacklist requires a client');
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  _key(jti) {
    return `${this.keyPrefix}${jti}`;
  }

  async isBlacklisted(jti) {
    const v = await this.client.get(this._key(jti));
    return v !== null && v !== undefined;
  }

  async blacklist(jti, ttlSeconds) {
    const ttl = Math.max(1, Math.floor(ttlSeconds));
    // ioredis: client.set(key, value, 'EX', ttl). Some clients
    // expose `.setex(key, ttl, value)`; fall back to that.
    if (typeof this.client.set === 'function') {
      await this.client.set(this._key(jti), '1', 'EX', ttl);
      return;
    }
    if (typeof this.client.setex === 'function') {
      await this.client.setex(this._key(jti), ttl, '1');
      return;
    }
    throw new Error('Redis client supports neither set nor setex');
  }
}
