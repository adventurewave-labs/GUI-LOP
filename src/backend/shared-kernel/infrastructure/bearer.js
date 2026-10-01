// @ts-check
/**
 * bearer — parse `Authorization: Bearer <credential>` in linear time.
 *
 * The previous pattern `/^Bearer\s+(.+)$/i` let `\s+` and `.+` compete for
 * the same whitespace, so `"Bearer " + " ".repeat(n)` backtracked
 * polynomially (flagged by CodeQL js/polynomial-redos). Here every quantifier
 * consumes a disjoint character class, and inputs are length-capped.
 */

const MAX_HEADER_LEN = 8192;
const BEARER_RE = /^Bearer[ \t]+(\S+)[ \t]*$/i;

/**
 * @param {unknown} header
 * @returns {string|null} the credential, or null if absent / malformed
 */
export function parseBearer(header) {
  if (typeof header !== 'string' || header.length === 0 || header.length > MAX_HEADER_LEN) {
    return null;
  }
  const m = BEARER_RE.exec(header);
  return m ? m[1] : null;
}
