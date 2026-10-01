/**
 * problem-details — RFC 9457 (`application/problem+json`) for every error.
 *
 * The bounded contexts historically emit three different error envelopes:
 *
 *   identity            { error: 'invalid_credentials', message }
 *   human-interaction   { error: { code, message, details } }
 *   workflow            { success: false, message, code }
 *
 * Rather than a breaking rewrite, this middleware upgrades any JSON error
 * response (status ≥ 400) in place: it adds the RFC 9457 members
 * `type`, `title`, `status`, `detail`, `instance` plus `code` and
 * `request_id` extensions, and keeps every legacy field untouched (RFC 9457
 * §3.2 explicitly allows extension members). Clients can migrate to
 * `type`/`code` at their own pace; existing parsers keep working.
 */

import { STATUS_CODES } from 'node:http';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
export const PROBLEM_TYPE_BASE = 'https://gui-lop.dev/problems/';

/** Extract the machine code from any of the legacy envelopes. */
export function legacyCode(body) {
  if (!body || typeof body !== 'object') return undefined;
  if (typeof body.error === 'string') return body.error;
  if (body.error && typeof body.error === 'object' && typeof body.error.code === 'string') return body.error.code;
  if (typeof body.code === 'string') return body.code;
  return undefined;
}

function legacyDetail(body) {
  if (typeof body.message === 'string') return body.message;
  if (body.error && typeof body.error === 'object' && typeof body.error.message === 'string') return body.error.message;
  return undefined;
}

/** `INVALID_RESPONSE` / `invalid_credentials` → `invalid-response` / `invalid-credentials`. */
export function codeSlug(code) {
  return String(code)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Build a problem document from status + (legacy) body.
 * @param {number} status
 * @param {object} [body]
 * @param {{ instance?: string, requestId?: string }} [ctx]
 */
export function toProblem(status, body = {}, { instance, requestId } = {}) {
  const code = legacyCode(body);
  const slug = code ? codeSlug(code) : '';
  return {
    type: slug ? `${PROBLEM_TYPE_BASE}${slug}` : 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    ...(legacyDetail(body) !== undefined ? { detail: legacyDetail(body) } : {}),
    ...(instance ? { instance } : {}),
    ...(code ? { code } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    // Legacy members last so nothing a client relies on is overwritten…
    ...body,
    // …except the RFC-defined `status`, which must match the HTTP status.
    status,
  };
}

function isProblemAlready(body) {
  return typeof body.type === 'string' && typeof body.title === 'string' && typeof body.status === 'number';
}

/**
 * Bodies with their own string `status` (health/readiness documents such as
 * `{ status: 'draining', checks }`) are not errors in the RFC 9457 sense, and
 * the RFC's numeric `status` would clobber their meaning — leave them as-is.
 */
function hasOwnStatusSemantics(body) {
  return typeof body.status === 'string';
}

/**
 * Express middleware: wraps `res.json` so error bodies become problem
 * documents. Mount once, before routers.
 */
export function problemDetailsMiddleware() {
  return (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (
        res.statusCode >= 400 &&
        body && typeof body === 'object' && !Array.isArray(body) &&
        !isProblemAlready(body) &&
        !hasOwnStatusSemantics(body)
      ) {
        const problem = toProblem(res.statusCode, body, {
          instance: req.originalUrl?.split('?')[0],
          requestId: req.id,
        });
        res.type(PROBLEM_CONTENT_TYPE);
        return json(problem);
      }
      return json(body);
    };
    next();
  };
}
