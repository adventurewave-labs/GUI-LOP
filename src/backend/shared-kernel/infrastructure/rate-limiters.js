/**
 * rate-limiters — ADR 0015 limiter factory.
 *
 * One place that decides *how* requests are counted so every limiter in the
 * app shares the same semantics:
 *
 *   - store:   Redis (`rate-limit-redis`) when a client is available, so the
 *              budget is global across replicas; in-memory otherwise (dev /
 *              tests — per process only).
 *   - headers: IETF `RateLimit` / `RateLimit-Policy` (draft-7); no legacy
 *              `X-RateLimit-*`.
 *   - keys:    IPv6 clients are bucketed by /64 so one host can't rotate
 *              through its prefix to multiply its budget; identifiers are
 *              hashed so raw emails never become Redis keys.
 *   - failure: `failClosed` limiters (auth) surface store errors as 503;
 *              others (general API) pass through when the store is down.
 */

import { createHash } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';

/** Normalise an IP for bucketing: IPv4 as-is, IPv6 → first 4 hextets (/64). */
export function ipBucket(ip) {
  if (typeof ip !== 'string' || ip.length === 0) return 'unknown';
  // eslint-disable-next-line security/detect-unsafe-regex -- fixed-count {1,3}/{3} quantifiers, anchored
  const v4mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4mapped) return v4mapped[1];
  if (!ip.includes(':')) return ip;
  // Expand "::" so we can take a stable /64 prefix.
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${full.slice(0, 4).map((x) => x.toLowerCase() || '0').join(':')}::/64`;
}

const UNLOADED_SHA = 'unloaded';

/**
 * Wrap `redis.call` for rate-limit-redis. The store fires `SCRIPT LOAD` from
 * its constructor without awaiting it; if Redis is unreachable at that
 * moment the rejection is unhandled and Node (≥15) crashes the process.
 * Resolve SCRIPT LOAD failures to a placeholder SHA instead: the first
 * EVALSHA then fails inside a request (handled → fail-open/closed policy),
 * and the store's own retry path reloads the script once Redis is back.
 */
export function safeSendCommand(redis, logger) {
  return async (...args) => {
    try {
      return await redis.call(...args);
    } catch (err) {
      if (String(args[0]).toUpperCase() === 'SCRIPT' && String(args[1]).toUpperCase() === 'LOAD') {
        logger?.warn?.('rate limiter: SCRIPT LOAD failed; will retry on first use', { err: err?.message });
        return UNLOADED_SHA;
      }
      throw err;
    }
  };
}

/** Stable, non-reversible key for a user-supplied identifier (email/username). */
export function identifierKey(raw) {
  const norm = String(raw ?? '').trim().toLowerCase();
  if (!norm) return null;
  return createHash('sha256').update(norm).digest('base64url').slice(0, 32);
}

/**
 * Build the limiter factory. Async because the Redis store module is loaded
 * on demand (no cost when Redis isn't configured).
 *
 * @param {{ redis?: { call: Function } | null, logger?: object, prefix?: string }} deps
 */
export async function createRateLimiterFactory({ redis = null, logger, prefix = 'rl' } = {}) {
  let RedisStore = null;
  if (redis) {
    const m = await import('rate-limit-redis');
    RedisStore = m.RedisStore ?? m.default;
  }
  const backend = RedisStore ? 'redis' : 'memory';

  /**
   * @param {string} name  unique limiter name (Redis key namespace)
   * @param {{ windowMs: number, limit: number, keyGenerator?: Function,
   *   skipSuccessfulRequests?: boolean, failClosed?: boolean, message?: string,
   *   skip?: Function }} opts
   */
  function create(name, {
    windowMs,
    limit,
    keyGenerator,
    skipSuccessfulRequests = false,
    failClosed = false,
    message = 'Too many requests',
    skip,
  }) {
    const limiter = rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skipSuccessfulRequests,
      // Fail-open limiters let traffic through when the store errors; auth
      // limiters must not (ADR 0015) — we turn the error into a 503 below.
      passOnStoreError: !failClosed,
      keyGenerator: keyGenerator ?? ((req) => ipBucket(req.ip)),
      store: RedisStore
        ? new RedisStore({ prefix: `${prefix}:${name}:`, sendCommand: safeSendCommand(redis, logger) })
        : undefined,
      handler: (req, res, _next, opts) => {
        res.status(opts.statusCode).json({ error: 'rate_limited', message, request_id: req.id });
      },
      ...(skip ? { skip } : {}),
    });
    return (req, res, next) => {
      limiter(req, res, (err) => {
        if (err) {
          logger?.error?.('rate limiter store error', { limiter: name, err, fail_closed: failClosed });
          if (failClosed) {
            if (!res.headersSent) res.status(503).json({ error: 'rate_limit_unavailable', request_id: req.id });
            return;
          }
        }
        next();
      });
    };
  }
  create.backend = backend;
  return create;
}
