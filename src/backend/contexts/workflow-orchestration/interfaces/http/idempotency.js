// @ts-check
import { idempotency, InMemoryHttpIdempotencyStore } from '../../../../shared-kernel/infrastructure/http-idempotency.js';

/**
 * `Idempotency-Key` for a single route handler (ADR 0024). Thin adapter over
 * the shared-kernel middleware, which owns the semantics: replay, 409 while
 * in flight, 422 on a payload mismatch, 5xx never cached, keys scoped to the
 * concrete path (not the route template — one key used to replay workflow
 * A's response for workflow B).
 *
 * @param {{ store: import('../../../../shared-kernel/infrastructure/http-idempotency.js').IdempotencyStore, route?: string, handler: Function }} opts
 *   `route` is accepted for backwards compatibility and ignored.
 */
export function withHttpIdempotency({ store, handler }) {
  const mw = idempotency({ store });
  return async (req, res, next) => {
    let proceed = false;
    await mw(req, res, (err) => {
      if (err) throw err;
      proceed = true; // new request: run the handler (its res.json is captured)
    });
    if (proceed) return handler(req, res, next);
    return undefined; // replayed / rejected by the middleware
  };
}

export { InMemoryHttpIdempotencyStore };
