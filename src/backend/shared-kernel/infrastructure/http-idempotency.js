// @ts-check
/**
 * http-idempotency — `Idempotency-Key` for unsafe requests, per the IETF
 * draft "The Idempotency-Key HTTP Header Field" (draft-ietf-httpapi-
 * idempotency-key-header) and ADR 0024. One implementation for every context.
 *
 *   first request with a key      → run the handler, store the response
 *   retry, same fingerprint       → replay the stored response (+ `Idempotent-Replayed: true`)
 *   retry while the first runs    → 409 Conflict  (draft §2.6: concurrent request)
 *   same key, different payload   → 422 Unprocessable Content (draft §2.6)
 *   malformed key                 → 400
 *
 * Replaced two in-memory copies that (a) were per-pod, so a retry landing on
 * another replica executed twice; (b) had no in-flight guard, so concurrent
 * duplicates both executed; (c) cached 5xx responses forever, so a retry
 * after a transient failure could never succeed; (d) scoped keys by route
 * *template*, so one key replayed workflow A's response for workflow B.
 *
 * Scope = (subject, method, concrete path, key); the fingerprint is a hash of
 * the JSON body. Only 2xx–4xx responses are stored; 5xx and thrown errors
 * release the key so the client can retry.
 */
import { createHash } from 'node:crypto';
import { isUuid } from './ids.js';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** A lock older than this is considered abandoned (crashed pod) and taken over. */
export const IDEMPOTENCY_LOCK_MS = 60 * 1000;
const KEY_RE = /^[\x21-\x7e]{1,255}$/; // visible ASCII, bounded

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** @param {unknown} body */
export function fingerprint(body) {
  return sha256(JSON.stringify(body ?? null));
}

/**
 * @typedef {{ status: number, body: unknown }} StoredResponse
 * @typedef {{ state: 'new' } | { state: 'in-flight' } | { state: 'mismatch' } | { state: 'replay', response: StoredResponse }} BeginResult
 * @typedef {{
 *   begin(scope: string, fp: string, meta?: { actorId?: string|null, route?: string, key?: string }): Promise<BeginResult>,
 *   complete(scope: string, response: StoredResponse): Promise<void>,
 *   release(scope: string): Promise<void>,
 * }} IdempotencyStore
 */

/** In-process store (dev/test, single replica). */
export class InMemoryHttpIdempotencyStore {
  constructor({ now = () => Date.now(), ttlMs = IDEMPOTENCY_TTL_MS, lockMs = IDEMPOTENCY_LOCK_MS } = {}) {
    /** @type {Map<string, { fp: string, response: StoredResponse|null, expiresAt: number, lockedAt: number }>} */
    this._m = new Map();
    this._now = now;
    this._ttlMs = ttlMs;
    this._lockMs = lockMs;
  }

  /** @returns {Promise<BeginResult>} */
  async begin(scope, fp) {
    const now = this._now();
    const e = this._m.get(scope);
    if (e && e.expiresAt > now) {
      if (e.fp !== fp) return { state: 'mismatch' };
      if (e.response) return { state: 'replay', response: e.response };
      if (now - e.lockedAt < this._lockMs) return { state: 'in-flight' };
    }
    this._m.set(scope, { fp, response: null, expiresAt: now + this._ttlMs, lockedAt: now });
    return { state: 'new' };
  }

  async complete(scope, response) {
    const e = this._m.get(scope);
    if (e) e.response = response;
  }

  async release(scope) {
    this._m.delete(scope);
  }
}

/**
 * Postgres store on `idempotency_keys` (migration 003 + 013). Shared by all
 * replicas; the unique `scope_key` makes `begin` an atomic claim.
 */
export class PgHttpIdempotencyStore {
  /** @param {{ query: Function }} pool */
  constructor(pool, { ttlMs = IDEMPOTENCY_TTL_MS, lockMs = IDEMPOTENCY_LOCK_MS } = {}) {
    this.pool = pool;
    this._ttlMs = ttlMs;
    this._lockMs = lockMs;
  }

  /** @returns {Promise<BeginResult>} */
  async begin(scope, fp, { actorId = null, route = '', key = '' } = {}) {
    // Expired rows never block a new claim.
    await this.pool.query(
      'DELETE FROM idempotency_keys WHERE scope_key = $1 AND expires_at <= NOW()',
      [scope],
    );
    const claimed = await this.pool.query(
      `INSERT INTO idempotency_keys
         (scope_key, actor_id, route, idempotency_key, request_hash, status_code, response_body, expires_at)
       VALUES ($1, $2, $3, $4, $5, 0, NULL, NOW() + ($6::text || ' milliseconds')::interval)
       ON CONFLICT (scope_key) DO NOTHING
       RETURNING id`,
      [scope, isUuid(actorId) ? actorId : null, route, key, fp, String(this._ttlMs)],
    );
    if (claimed.rowCount > 0) return { state: 'new' };

    const { rows } = await this.pool.query(
      `SELECT request_hash, status_code, response_body,
              (NOW() - created_at) > ($2::text || ' milliseconds')::interval AS stale
         FROM idempotency_keys WHERE scope_key = $1`,
      [scope, String(this._lockMs)],
    );
    const row = rows[0];
    if (!row) return this.begin(scope, fp, { actorId, route, key }); // raced with a delete
    if (row.request_hash !== fp) return { state: 'mismatch' };
    if (row.status_code > 0) return { state: 'replay', response: { status: row.status_code, body: row.response_body } };
    if (!row.stale) return { state: 'in-flight' };
    // Abandoned lock (the first attempt's pod died): take it over atomically.
    const took = await this.pool.query(
      `UPDATE idempotency_keys SET created_at = NOW()
        WHERE scope_key = $1 AND status_code = 0
          AND (NOW() - created_at) > ($2::text || ' milliseconds')::interval`,
      [scope, String(this._lockMs)],
    );
    return took.rowCount > 0 ? { state: 'new' } : { state: 'in-flight' };
  }

  async complete(scope, response) {
    await this.pool.query(
      'UPDATE idempotency_keys SET status_code = $2, response_body = $3 WHERE scope_key = $1',
      [scope, response.status, JSON.stringify(response.body ?? null)],
    );
  }

  async release(scope) {
    await this.pool.query('DELETE FROM idempotency_keys WHERE scope_key = $1 AND status_code = 0', [scope]);
  }
}

/**
 * Express middleware. Mount on unsafe routes; requests without the header
 * pass straight through.
 *
 * @param {{ store: IdempotencyStore, subject?: (req: any) => string|null }} opts
 */
export function idempotency({ store, subject = defaultSubject }) {
  return async function idempotencyMiddleware(req, res, next) {
    const key = req.get?.('Idempotency-Key') ?? req.headers?.['idempotency-key'];
    if (key === undefined || key === null || key === '') return next();
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      return res.status(400).json({ error: 'invalid_idempotency_key', message: 'Idempotency-Key must be 1-255 visible ASCII characters' });
    }
    const who = subject(req) ?? 'anon';
    const path = `${req.baseUrl ?? ''}${req.path ?? ''}`;
    const route = `${req.method} ${path}`;
    const scope = sha256(`${who}\n${route}\n${key}`);
    const fp = fingerprint(req.body);

    let result;
    try {
      result = await store.begin(scope, fp, { actorId: req.principal?.userId ?? req.user?.id ?? null, route, key });
    } catch (err) {
      return next(err);
    }
    if (result.state === 'mismatch') {
      return res.status(422).json({ error: 'idempotency_key_reused', message: 'Idempotency-Key was already used with a different request payload' });
    }
    if (result.state === 'in-flight') {
      res.set('Retry-After', '1');
      return res.status(409).json({ error: 'idempotency_in_flight', message: 'A request with this Idempotency-Key is still being processed' });
    }
    if (result.state === 'replay') {
      res.set('Idempotent-Replayed', 'true');
      return res.status(result.response.status).json(result.response.body);
    }

    // New: capture the response; store 2xx-4xx, release on 5xx / no response.
    let settled = false;
    const settle = async (status, body) => {
      if (settled) return;
      settled = true;
      try {
        if (status && status < 500) await store.complete(scope, { status, body });
        else await store.release(scope);
      } catch {
        /* storage hiccup: the response still goes out; worst case the key is retried */
      }
    };
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      settle(res.statusCode, body);
      return originalJson(body);
    };
    res.once?.('close', () => { if (!settled) settle(0, undefined); });
    return next();
  };
}

function defaultSubject(req) {
  return req.principal?.userId ?? req.user?.id ?? (req.ip ? `ip:${req.ip}` : null);
}
