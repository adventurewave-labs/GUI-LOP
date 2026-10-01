/**
 * ids — identifier helpers for persistence adapters.
 *
 * Postgres `uuid` columns reject non-UUID text with SQLSTATE 22P02
 * ("invalid input syntax for type uuid"). Repositories that look rows up
 * by a caller-supplied id must treat a malformed id as "not found"
 * (→ null → HTTP 404), not let the driver error bubble up as a 500.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Unwrap an id value object (`{ value: string }`, e.g. `ApiKeyId`, `UserId`)
 * to its primitive; strings and anything else pass through unchanged.
 * @param {unknown} v
 */
export function idValue(v) {
  return v && typeof v === 'object' && typeof (/** @type {any} */ (v).value) === 'string'
    ? /** @type {any} */ (v).value
    : v;
}

/**
 * True for a UUID string or an id value object wrapping one. Accepting
 * value objects matters: domain code passes `ApiKeyId` etc. straight to
 * `findById`, and rejecting them would turn every lookup into "not found".
 * @param {unknown} v
 */
export function isUuid(v) {
  const s = idValue(v);
  return typeof s === 'string' && UUID_RE.test(s);
}
