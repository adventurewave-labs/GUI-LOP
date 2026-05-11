/**
 * telemetry.test.js — verifies the structured log shape emitted per call.
 */
import { withTelemetry } from '../../../infrastructure/ai/telemetry.js';

function spyLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe('withTelemetry', () => {
  test('emits info on success with duration and token usage', async () => {
    const logger = spyLogger();
    let t = 1000;
    const now = () => t;
    const out = await withTelemetry(
      async () => { t += 5; return { value: 'ok', tokenUsage: { prompt: 1, completion: 2, total: 3 } }; },
      { provider: 'openai', model: 'gpt-x', op: 'generate_ui' },
      { logger, now },
    );
    expect(out.value).toBe('ok');
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [msg, fields] = logger.info.mock.calls[0];
    expect(msg).toBe('ai.call');
    expect(fields).toMatchObject({
      provider: 'openai',
      model: 'gpt-x',
      op: 'generate_ui',
      ok: true,
      durationMs: 5,
      tokenUsage: { prompt: 1, completion: 2, total: 3 },
    });
  });

  test('emits error on failure with the error shape', async () => {
    const logger = spyLogger();
    let t = 0;
    const now = () => { const v = t; t += 10; return v; };
    const err = Object.assign(new Error('boom'), { code: 'X', name: 'AIBadResponse' });
    await expect(
      withTelemetry(
        async () => { throw err; },
        { provider: 'anthropic', model: 'claude-haiku-4-5', op: 'generate_ui' },
        { logger, now },
      ),
    ).rejects.toBe(err);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [msg, fields] = logger.error.mock.calls[0];
    expect(msg).toBe('ai.call');
    expect(fields.ok).toBe(false);
    expect(fields.error).toEqual({ name: 'AIBadResponse', code: 'X', message: 'boom' });
    expect(fields.provider).toBe('anthropic');
  });

  test('uses a custom tokenUsage extractor when supplied', async () => {
    const logger = spyLogger();
    await withTelemetry(
      async () => ({ raw: { usage: { p: 7, c: 8 } } }),
      { provider: 'openai', model: 'm', op: 'classify' },
      { logger, tokenUsage: (out) => ({ prompt: out.raw.usage.p, completion: out.raw.usage.c, total: out.raw.usage.p + out.raw.usage.c }) },
    );
    const [, fields] = logger.info.mock.calls[0];
    expect(fields.tokenUsage).toEqual({ prompt: 7, completion: 8, total: 15 });
  });

  test('works without a logger', async () => {
    const out = await withTelemetry(
      async () => 'ok',
      { provider: 'stub', model: 's', op: 'generate_ui' },
    );
    expect(out).toBe('ok');
  });
});
