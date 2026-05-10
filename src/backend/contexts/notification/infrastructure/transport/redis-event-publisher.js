/**
 * RedisEventPublisher — Redis pub/sub adapter for cross-instance fan-out.
 *
 * Accepts an injected `redis` client (ioredis-compatible) for testability;
 * if none is provided, lazily constructs one from `ioredis`.
 *
 * The publisher needs two clients: one for `publish`, one for `subscribe`
 * (Redis pub/sub places the connection into subscriber mode).
 */

import { EventPublisher } from '../../application/ports/event-publisher.js';

export class RedisEventPublisher extends EventPublisher {
  constructor({ pubClient, subClient, factory } = {}) {
    super();
    this._pub = pubClient ?? null;
    this._sub = subClient ?? null;
    this._factory = factory ?? null;
    this._handlers = new Map();
    this._initialized = !!(pubClient && subClient);
  }

  async _ensureClients() {
    if (this._initialized) return;
    if (!this._factory) {
      const mod = await import('ioredis').catch(() => null);
      if (!mod) {
        throw new Error(
          'ioredis is not installed and no factory provided to RedisEventPublisher'
        );
      }
      const Redis = mod.default ?? mod;
      this._pub = this._pub ?? new Redis();
      this._sub = this._sub ?? new Redis();
    } else {
      this._pub = this._pub ?? this._factory();
      this._sub = this._sub ?? this._factory();
    }
    this._sub.on?.('message', (channel, message) => {
      const set = this._handlers.get(channel);
      if (!set) return;
      let envelope;
      try {
        envelope = JSON.parse(message);
      } catch {
        envelope = message;
      }
      for (const h of set) {
        Promise.resolve(h(envelope)).catch(() => {});
      }
    });
    this._initialized = true;
  }

  async publish(channel, envelope) {
    await this._ensureClients();
    await this._pub.publish(channel, JSON.stringify(envelope));
  }

  async subscribe(channel, handler) {
    await this._ensureClients();
    if (!this._handlers.has(channel)) {
      this._handlers.set(channel, new Set());
      await this._sub.subscribe(channel);
    }
    this._handlers.get(channel).add(handler);
    return async () => {
      const set = this._handlers.get(channel);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        this._handlers.delete(channel);
        await this._sub.unsubscribe(channel);
      }
    };
  }

  async close() {
    if (this._pub?.quit) await this._pub.quit();
    if (this._sub?.quit) await this._sub.quit();
    this._handlers.clear();
  }
}
