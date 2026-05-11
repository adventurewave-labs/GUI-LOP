import { createHash } from 'node:crypto';

const HEADER = 'idempotency-key';
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * In-process idempotency store. Production should swap for a
 * Redis-backed implementation (ADR 0024).
 *
 * Stores per `(userOrIp + route + key)` -> { bodyHash, status, body }.
 */
export class InMemoryIdempotencyStore {
  constructor({ now = () => Date.now(), ttlMs = TTL_MS } = {}) {
    this._entries = new Map();
    this._now = now;
    this._ttlMs = ttlMs;
  }

  _evict(k) {
    const e = this._entries.get(k);
    if (!e) return;
    if (e.expiresAt <= this._now()) this._entries.delete(k);
  }

  get(k) {
    this._evict(k);
    return this._entries.get(k) ?? null;
  }

  set(k, value) {
    this._entries.set(k, { ...value, expiresAt: this._now() + this._ttlMs });
  }
}

function bodyHash(body) {
  const s = body == null ? '' : JSON.stringify(body);
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Express middleware honouring `Idempotency-Key`.
 * On a hit with same body hash → replays the stored response.
 * On a hit with different body → 409 Conflict.
 * On a miss → captures `res.json(...)` to store the result.
 */
export function makeIdempotencyMiddleware({ store }) {
  return function idempotencyMiddleware(req, res, next) {
    const key = req.headers?.[HEADER];
    if (!key) return next();
    const subject = req.principal?.userId ?? req.ip ?? 'anon';
    const route = `${req.method} ${req.baseUrl ?? ''}${req.path ?? ''}`;
    const storeKey = `${subject}|${route}|${key}`;
    const hash = bodyHash(req.body ?? {});

    const existing = store.get(storeKey);
    if (existing) {
      if (existing.bodyHash !== hash) {
        return res
          .status(409)
          .json({
            error: 'idempotency_conflict',
            message: 'Idempotency-Key reused with a different body',
          });
      }
      return res.status(existing.status).json(existing.body);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        store.set(storeKey, {
          bodyHash: hash,
          status: res.statusCode,
          body,
        });
      } catch {
        /* ignore store errors */
      }
      return originalJson(body);
    };
    return next();
  };
}
