/**
 * request-context + logger enrichment/redaction.
 */
import { runWithContext, getContext, setContextField } from '../request-context.js';
import { createLogger, redact } from '../logger.js';

describe('request-context', () => {
  test('empty outside a request; set is a no-op', () => {
    expect(getContext()).toBeUndefined();
    expect(() => setContextField('x', 1)).not.toThrow();
  });

  test('propagates across awaits and isolates concurrent requests', async () => {
    const seen = await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        runWithContext({ request_id: id }, async () => {
          await new Promise((r) => setTimeout(r, Math.random() * 10));
          setContextField('user_id', `u-${id}`);
          await Promise.resolve();
          return { ...getContext() };
        }),
      ),
    );
    expect(seen).toEqual([
      { request_id: 'a', user_id: 'u-a' },
      { request_id: 'b', user_id: 'u-b' },
      { request_id: 'c', user_id: 'u-c' },
    ]);
  });

  test('ignores null/undefined values', () => {
    runWithContext({}, () => {
      setContextField('user_id', undefined);
      setContextField('sid', null);
      expect(getContext()).toEqual({});
    });
  });
});

describe('redact', () => {
  test('masks sensitive keys at any depth, case-insensitively', () => {
    const out = redact({
      Authorization: 'Bearer x',
      body: { password: 'p', nested: { refresh_token: 'r', ok: 1 } },
      headers: [{ cookie: 'c' }],
      apiKey: 'k',
      'x-api-key': 'k2',
    });
    expect(out).toEqual({
      Authorization: '[REDACTED]',
      body: { password: '[REDACTED]', nested: { refresh_token: '[REDACTED]', ok: 1 } },
      headers: [{ cookie: '[REDACTED]' }],
      apiKey: '[REDACTED]',
      'x-api-key': '[REDACTED]',
    });
  });

  test('serialises errors, dates, and breaks cycles', () => {
    const e = Object.assign(new Error('boom'), { code: 'E1' });
    const cyc = { a: 1 };
    cyc.self = cyc;
    const out = redact({ e, d: new Date(0), cyc });
    expect(out.e).toEqual(expect.objectContaining({ name: 'Error', message: 'boom', code: 'E1' }));
    expect(out.d).toBe('1970-01-01T00:00:00.000Z');
    expect(out.cyc.self).toBe('[Circular]');
  });

  test('does not mutate the input', () => {
    const input = { token: 't' };
    redact(input);
    expect(input.token).toBe('t');
  });
});

describe('logger context enrichment', () => {
  let out;
  beforeEach(() => {
    out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => out.mockRestore());

  const last = () => JSON.parse(out.mock.calls.at(-1)[0]);

  test('injects ambient context fields', () => {
    const log = createLogger({ level: 'info' });
    runWithContext({ request_id: 'r-1' }, () => {
      setContextField('user_id', 'u-9');
      log.info('hi', { k: 1 });
    });
    expect(last()).toEqual(expect.objectContaining({ msg: 'hi', request_id: 'r-1', user_id: 'u-9', k: 1 }));
  });

  test('redacts credentials passed as fields', () => {
    createLogger({ level: 'info' }).info('login', { email: 'a@b.c', password: 'hunter2' });
    const rec = last();
    expect(rec.password).toBe('[REDACTED]');
    expect(JSON.stringify(rec)).not.toContain('hunter2');
  });
});
