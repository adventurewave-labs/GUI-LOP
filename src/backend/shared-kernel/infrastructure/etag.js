// @ts-check
/**
 * Version-based entity tags + conditional requests (RFC 9110 §8.8.3, §13).
 *
 * Aggregates carry a monotonically increasing `version` (already used for
 * optimistic locking inside the repositories). Exposing it as a strong ETag
 * lets clients make *conditional* writes with `If-Match`, so two operators
 * acting on the same stale view can't silently overwrite each other's intent
 * (the lost-update problem) — the second gets 412 and re-reads.
 */

/** Strong ETag for an aggregate version. */
export const versionEtag = (version) => `"v${Number(version)}"`;

/**
 * Parse `If-Match`. Strong comparison only (§13.1.1): weak tags never match.
 * @param {string | undefined} header
 * @returns {null | { any: true } | { versions: number[] }} null when absent
 */
export function parseIfMatch(header) {
  if (header === undefined || header === null || String(header).trim() === '') return null;
  const h = String(header).trim();
  if (h === '*') return { any: true };
  const versions = [];
  for (const raw of h.split(',')) {
    const m = /^"v(\d{1,15})"$/.exec(raw.trim()); // W/"…" deliberately not accepted
    if (m) versions.push(Number(m[1]));
  }
  return { versions };
}

/**
 * The version a command must find, or undefined when unconditional.
 * `*` only requires existence (the use case 404s otherwise). A header that
 * names no usable strong tag can never match: -1 forces a 412.
 * @param {ReturnType<typeof parseIfMatch>} cond
 * @returns {number[] | undefined}
 */
export function expectedVersions(cond) {
  if (!cond || 'any' in cond) return undefined;
  return cond.versions.length > 0 ? cond.versions : [-1];
}

/** `If-None-Match` (GET): true when the client's cached copy is current. */
export function notModified(header, etag) {
  if (!header) return false;
  const h = String(header).trim();
  if (h === '*') return true;
  // Weak comparison is allowed for If-None-Match (§13.1.2).
  return h.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);
}
