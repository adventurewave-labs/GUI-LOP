import crypto from 'node:crypto';
import { ConflictError } from '../../shared-kernel-stubs.js';

/**
 * `Idempotency-Key` header handling per ADR 0024.
 *
 * If the client supplies the header, we look up `(actor, route, key)`:
 *   - cached + same body hash -> return stored response;
 *   - cached + different body -> 409;
 *   - not cached -> run handler, cache, return.
 *
 * If the client omits the header, the handler runs normally.
 */
export function withHttpIdempotency({ store, route, handler }) {
  return async (req, res, next) => {
    const idemKey = req.header('Idempotency-Key');
    const actor = req.user?.id ?? 'anonymous';
    if (!idemKey || !store) {
      return handler(req, res, next);
    }
    const bodyHash = hashBody(req.body);
    const existing = await store.get({ actor, route, key: idemKey });
    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        throw new ConflictError('Idempotency key reused with different body');
      }
      res.status(existing.response.status ?? 200).json(existing.response.body);
      return undefined;
    }
    // Capture response for storage.
    const original = res.json.bind(res);
    let captured;
    res.json = (body) => {
      captured = { status: res.statusCode, body };
      return original(body);
    };
    await handler(req, res, next);
    if (captured) {
      await store.put(
        { actor, route, key: idemKey },
        { bodyHash, response: captured },
      );
    }
    return undefined;
  };
}

function hashBody(body) {
  const json = JSON.stringify(body ?? null);
  return crypto.createHash('sha256').update(json).digest('hex');
}
