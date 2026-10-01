/**
 * trace-context.test.js — W3C traceparent parsing and propagation.
 */
import {
  parseTraceparent,
  resolveInboundTrace,
  traceContextMiddleware,
  outboundTraceHeaders,
  newTraceId,
  newSpanId,
  formatTraceparent,
} from '../trace-context.js';
import { runWithContext, getContext } from '../request-context.js';

const TID = '4bf92f3577b34da6a3ce929d0e0e4736';
const PID = '00f067aa0ba902b7';
const VALID = `00-${TID}-${PID}-01`;

describe('parseTraceparent', () => {
  test('accepts the spec example', () => {
    expect(parseTraceparent(VALID)).toEqual({ version: '00', traceId: TID, parentId: PID, flags: '01' });
  });

  test.each([
    ['uppercase hex', `00-${TID.toUpperCase()}-${PID}-01`],
    ['all-zero trace id', `00-${'0'.repeat(32)}-${PID}-01`],
    ['all-zero parent id', `00-${TID}-${'0'.repeat(16)}-01`],
    ['version ff', `ff-${TID}-${PID}-01`],
    ['v00 with extra field', `${VALID}-extra`],
    ['short trace id', `00-${TID.slice(1)}-${PID}-01`],
    ['garbage', 'not-a-traceparent'],
    ['non-string', 42],
  ])('rejects %s', (_label, header) => {
    expect(parseTraceparent(header)).toBeNull();
  });

  test('future versions may carry extra fields', () => {
    expect(parseTraceparent(`01-${TID}-${PID}-01-future`)).toEqual(
      expect.objectContaining({ version: '01', traceId: TID }),
    );
  });
});

describe('id generation', () => {
  test('shapes', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
    expect(formatTraceparent(TID, PID)).toBe(VALID);
  });
});

describe('resolveInboundTrace', () => {
  const gen = { genTraceId: () => 'a'.repeat(32), genSpanId: () => 'b'.repeat(16) };

  test('continues a valid inbound trace with a new server span', () => {
    const t = resolveInboundTrace({ traceparent: VALID, tracestate: 'vendor=abc,other=1' }, gen);
    expect(t).toEqual({
      traceId: TID,
      spanId: 'b'.repeat(16),
      parentSpanId: PID,
      flags: '01',
      tracestate: 'vendor=abc,other=1',
      continued: true,
    });
  });

  test('preserves the unsampled flag', () => {
    expect(resolveInboundTrace({ traceparent: `00-${TID}-${PID}-00` }, gen).flags).toBe('00');
  });

  test('starts a new trace on invalid input and drops tracestate', () => {
    const t = resolveInboundTrace({ traceparent: 'bogus', tracestate: 'x=1' }, gen);
    expect(t).toEqual({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), flags: '01', continued: false });
  });

  test('discards oversized or malformed tracestate', () => {
    expect(resolveInboundTrace({ traceparent: VALID, tracestate: `k=${'v'.repeat(600)}` }, gen).tracestate).toBeUndefined();
    expect(resolveInboundTrace({ traceparent: VALID, tracestate: 'no-equals-sign' }, gen).tracestate).toBeUndefined();
    expect(resolveInboundTrace({ traceparent: VALID, tracestate: 'k=v\u0000' }, gen).tracestate).toBeUndefined();
  });
});

describe('middleware + outbound propagation', () => {
  test('stamps context, sets traceresponse, and outbound headers carry the server span', () => {
    const headers = {};
    const req = { headers: { traceparent: VALID, tracestate: 'v=1' } };
    const res = { setHeader: (k, v) => { headers[k] = v; } };
    runWithContext({ request_id: 'r' }, () => {
      traceContextMiddleware()(req, res, () => {
        const ctx = getContext();
        expect(ctx.trace_id).toBe(TID);
        expect(ctx.span_id).toMatch(/^[0-9a-f]{16}$/);
        expect(ctx.span_id).not.toBe(PID);
        expect(headers.traceresponse).toBe(`00-${TID}-${ctx.span_id}-01`);
        expect(outboundTraceHeaders()).toEqual({
          traceparent: `00-${TID}-${ctx.span_id}-01`,
          tracestate: 'v=1',
        });
        // flags/tracestate are symbol-keyed: never enumerated into logs.
        expect(Object.keys(ctx)).toEqual(['request_id', 'trace_id', 'span_id']);
      });
    });
  });

  test('outbound headers are empty outside a request', () => {
    expect(outboundTraceHeaders()).toEqual({});
  });
});
