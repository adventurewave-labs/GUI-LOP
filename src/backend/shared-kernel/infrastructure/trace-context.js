/**
 * trace-context — W3C Trace Context (traceparent / tracestate) without an
 * SDK dependency.
 *
 *   traceparent: 00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>
 *
 * Inbound: a valid `traceparent` continues the caller's trace with a fresh
 * span id for this server hop; anything invalid starts a new trace (per
 * spec, a malformed header MUST NOT be propagated). Outbound: adapters call
 * `outboundTraceHeaders()` so vendor gateways / proxies / downstream
 * services join the same trace.
 *
 * `trace_id` / `span_id` live as plain fields on the request context (and so
 * appear on every log line); flags and tracestate are held under a symbol so
 * the logger's Object.entries walk never emits them.
 *
 * Swapping in the OpenTelemetry SDK later is a drop-in: its propagator
 * reads/writes the same headers.
 */

import { randomBytes } from 'node:crypto';
import { getContext, setContextField } from './request-context.js';

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN = '0'.repeat(16);
const MAX_TRACESTATE_LEN = 512;
const TRACE_META = Symbol.for('gui-lop.trace-meta');

/**
 * Parse a `traceparent` header. Returns null for anything the spec says to
 * discard (bad shape, version ff, all-zero ids, extra fields on v00).
 * @param {unknown} header
 * @returns {{ version: string, traceId: string, parentId: string, flags: string } | null}
 */
export function parseTraceparent(header) {
  if (typeof header !== 'string') return null;
  const m = TRACEPARENT_RE.exec(header.trim());
  if (!m) return null;
  const [, version, traceId, parentId, flags, rest] = m;
  if (version === 'ff') return null;
  if (version === '00' && rest !== undefined) return null;
  if (traceId === ZERO_TRACE || parentId === ZERO_SPAN) return null;
  return { version, traceId, parentId, flags };
}

/** @returns {string} 32-hex trace id (never all zeros). */
export function newTraceId() {
  let id;
  do { id = randomBytes(16).toString('hex'); } while (id === ZERO_TRACE);
  return id;
}

/** @returns {string} 16-hex span id (never all zeros). */
export function newSpanId() {
  let id;
  do { id = randomBytes(8).toString('hex'); } while (id === ZERO_SPAN);
  return id;
}

/** Format a version-00 traceparent. */
export function formatTraceparent(traceId, spanId, flags = '01') {
  return `00-${traceId}-${spanId}-${flags}`;
}

/** Basic tracestate sanity: bounded length, printable, list-member shaped. */
function sanitiseTracestate(raw) {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim();
  if (!v || v.length > MAX_TRACESTATE_LEN) return undefined;
  if (!/^[\x20-\x7e]+$/.test(v)) return undefined;
  if (!v.split(',').every((m) => !m.trim() || /^[^=\s]+=[^=,]*$/.test(m.trim()))) return undefined;
  return v;
}

/**
 * Resolve the server span for an inbound request.
 * @param {{ traceparent?: string, tracestate?: string }} headers
 * @param {{ genTraceId?: () => string, genSpanId?: () => string }} [gen]
 */
export function resolveInboundTrace(headers, { genTraceId = newTraceId, genSpanId = newSpanId } = {}) {
  const parent = parseTraceparent(headers?.traceparent);
  if (parent) {
    return {
      traceId: parent.traceId,
      spanId: genSpanId(),
      parentSpanId: parent.parentId,
      flags: parent.flags,
      tracestate: sanitiseTracestate(headers?.tracestate),
      continued: true,
    };
  }
  return { traceId: genTraceId(), spanId: genSpanId(), flags: '01', continued: false };
}

/**
 * Express middleware: resolve the trace, stamp it on the request context,
 * and expose it to the caller via the `traceresponse` header
 * (W3C Trace Context Level 2).
 * Must run after the middleware that opens the request context.
 */
export function traceContextMiddleware(opts) {
  return (req, res, next) => {
    const t = resolveInboundTrace(req.headers ?? {}, opts);
    req.trace = t;
    setContextField('trace_id', t.traceId);
    setContextField('span_id', t.spanId);
    const ctx = getContext();
    if (ctx) ctx[TRACE_META] = { flags: t.flags, tracestate: t.tracestate };
    res.setHeader('traceresponse', formatTraceparent(t.traceId, t.spanId, t.flags));
    next();
  };
}

/**
 * Headers to attach to an outbound call made while serving a request.
 * Empty object outside a request (background jobs start no trace here).
 * @returns {Record<string, string>}
 */
export function outboundTraceHeaders() {
  const ctx = getContext();
  if (!ctx?.trace_id || !ctx?.span_id) return {};
  const meta = ctx[TRACE_META] ?? {};
  const headers = { traceparent: formatTraceparent(ctx.trace_id, ctx.span_id, meta.flags ?? '01') };
  if (meta.tracestate) headers.tracestate = meta.tracestate;
  return headers;
}
