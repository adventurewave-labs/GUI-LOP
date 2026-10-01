/**
 * http-hardening — framework-level HTTP concerns for the composition root.
 *
 * Kept out of main.js so each piece is unit-testable in isolation:
 *   - request-id propagation (validated, echoed on the response)
 *   - `trust proxy` parsing
 *   - JSON error envelope that respects client-error status codes
 *   - Node HTTP server timeouts (slowloris / LB keep-alive alignment)
 *   - bounded dependency probes for readiness checks
 */

import { randomUUID } from 'node:crypto';
import { runWithContext, getContext } from '../shared-kernel/infrastructure/request-context.js';

/** Inbound ids are echoed into logs + headers, so restrict their shape. */
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Attach `req.id`, echo it as `X-Request-Id`, and open the per-request
 * AsyncLocalStorage context so every log line in the request carries it.
 * Untrusted inbound values that fail validation are replaced
 * (header/log injection guard).
 */
export function requestIdMiddleware({ genId = randomUUID } = {}) {
  return (req, res, next) => {
    const inbound = req.get?.('X-Request-Id') ?? req.headers?.['x-request-id'];
    req.id = typeof inbound === 'string' && REQUEST_ID_RE.test(inbound) ? inbound : genId();
    res.setHeader('X-Request-Id', req.id);
    runWithContext({ request_id: req.id }, next);
  };
}

/**
 * Bounded-cardinality route label: the matched Express route template
 * (`/api/v1/workflows/:id`), never the raw path. Unmatched → `unmatched`.
 */
export function routeTemplate(req) {
  const p = req.route?.path;
  if (typeof p !== 'string') return 'unmatched';
  return `${req.baseUrl ?? ''}${p}` || '/';
}

/** Paths logged at debug instead of info (probe noise). */
const QUIET_PATHS = new Set(['/livez', '/readyz', '/health', '/metrics']);

/**
 * One structured line per completed (or aborted) request. Logs the path
 * only — never the query string, which can carry `?token=` credentials.
 */
export function accessLogMiddleware({ logger, now = () => process.hrtime.bigint() } = {}) {
  return (req, res, next) => {
    const start = now();
    // 'finish'/'close' fire from socket callbacks where the ALS store may be
    // gone; hold the live context object (auth enriches it later).
    const ctx = getContext();
    let logged = false;
    const done = (aborted) => {
      if (logged) return;
      logged = true;
      const durationMs = Number(now() - start) / 1e6;
      const status = aborted && !res.headersSent ? 499 : res.statusCode;
      const level = status >= 500 ? 'error' : QUIET_PATHS.has(req.path) ? 'debug' : 'info';
      logger?.[level]?.('http_request', {
        ...(ctx ?? {}),
        method: req.method,
        route: routeTemplate(req),
        path: req.path,
        status,
        duration_ms: Math.round(durationMs * 100) / 100,
        bytes_out: Number(res.getHeader?.('content-length')) || undefined,
        ip: req.ip,
        user_agent: req.get?.('user-agent'),
        ...(aborted ? { aborted: true } : {}),
      });
    };
    res.once('finish', () => done(false));
    res.once('close', () => done(!res.writableFinished));
    next();
  };
}

/**
 * Translate the TRUST_PROXY env string into an Express `trust proxy` value.
 * @param {string|undefined} raw
 * @returns {boolean|number|string[]}
 */
export function parseTrustProxy(raw) {
  const v = String(raw ?? 'false').trim();
  if (v === '' || v.toLowerCase() === 'false') return false;
  if (v.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Final Express error handler. 4xx errors raised by middleware (e.g.
 * body-parser's 400 malformed JSON / 413 payload too large) keep their
 * status instead of collapsing into 500; 5xx details are never leaked.
 */
export function jsonErrorHandler({ logger } = {}) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    const raw = Number(err?.status ?? err?.statusCode);
    const status = Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;
    const requestId = req?.id;

    if (status >= 500) {
      logger?.error?.('unhandled request error', {
        request_id: requestId,
        method: req?.method,
        path: req?.path,
        err: err?.message ?? String(err),
        stack: err?.stack,
      });
    } else {
      logger?.debug?.('client request error', {
        request_id: requestId,
        status,
        type: err?.type,
      });
    }

    if (res.headersSent) {
      res.destroy?.();
      return;
    }
    const body =
      status >= 500
        ? { error: 'internal_error', message: 'Unexpected error' }
        : {
            error: err?.type === 'entity.too.large' ? 'payload_too_large' : 'bad_request',
            message: err?.expose === false ? 'Bad request' : err?.message ?? 'Bad request',
          };
    if (requestId) body.request_id = requestId;
    res.status(status).json(body);
  };
}

/**
 * Apply server-level timeouts. `headersTimeout` must exceed
 * `keepAliveTimeout` so Node never closes a socket the LB considers live.
 */
export function applyServerTimeouts(server, config) {
  const keepAlive = config.HTTP_KEEPALIVE_TIMEOUT_MS;
  server.keepAliveTimeout = keepAlive;
  server.headersTimeout = Math.max(config.HTTP_HEADERS_TIMEOUT_MS, keepAlive + 1000);
  server.requestTimeout = Math.max(config.HTTP_REQUEST_TIMEOUT_MS, server.headersTimeout);
  return server;
}

/**
 * Run a dependency probe with a hard deadline so a hung DB/Redis can't
 * wedge the readiness endpoint (kubelet probe timeouts default to 1s).
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} timeoutMs
 * @returns {Promise<{ok: true, value: T} | {ok: false, error: string}>}
 */
export async function probeWithTimeout(fn, timeoutMs) {
  let timer;
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('probe_timeout')), timeoutMs);
        timer.unref?.();
      }),
    ]);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err?.code ?? err?.message ?? 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}
