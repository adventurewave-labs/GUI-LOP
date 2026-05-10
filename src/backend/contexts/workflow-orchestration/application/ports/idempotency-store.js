/**
 * Idempotency store (ADR 0024).
 *
 * @typedef {object} IdempotencyStore
 * @property {(key: { actor: string, route: string, key: string })
 *   => Promise<{ bodyHash: string, response: any }|null>} get
 * @property {(key: { actor: string, route: string, key: string },
 *   value: { bodyHash: string, response: any, ttlMs?: number })
 *   => Promise<void>} put
 */

export class InMemoryIdempotencyStore {
  constructor({ now = () => Date.now() } = {}) {
    this._records = new Map();
    this._now = now;
  }

  _composite({ actor, route, key }) {
    return `${actor}::${route}::${key}`;
  }

  _gc() {
    const t = this._now();
    for (const [k, v] of this._records.entries()) {
      if (v.expiresAt && v.expiresAt <= t) this._records.delete(k);
    }
  }

  async get(key) {
    this._gc();
    const r = this._records.get(this._composite(key));
    if (!r) return null;
    return { bodyHash: r.bodyHash, response: r.response };
  }

  async put(key, value) {
    this._gc();
    const ttl = value.ttlMs ?? 24 * 60 * 60 * 1000;
    this._records.set(this._composite(key), {
      bodyHash: value.bodyHash,
      response: value.response,
      expiresAt: this._now() + ttl,
    });
  }
}
