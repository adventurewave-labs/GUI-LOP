/**
 * ids — identifier helpers for persistence adapters.
 *
 * Postgres `uuid` columns reject non-UUID text with SQLSTATE 22P02
 * ("invalid input syntax for type uuid"). Repositories that look rows up
 * by a caller-supplied id must treat a malformed id as "not found"
 * (→ null → HTTP 404), not let the driver error bubble up as a 500.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {unknown} v @returns {v is string} */
export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}
