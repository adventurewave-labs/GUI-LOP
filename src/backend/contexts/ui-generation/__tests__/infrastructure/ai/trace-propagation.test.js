/**
 * trace-propagation.test.js — AI adapters forward W3C trace headers.
 *
 * Offline only: a fake fetch captures request headers; no vendor calls.
 */
import { AnthropicProvider } from '../../../infrastructure/ai/anthropic/anthropic-provider.js';
import { OpenAIProvider } from '../../../infrastructure/ai/openai/openai-provider.js';
import { runWithContext } from '../../../../../shared-kernel/infrastructure/request-context.js';
import { traceContextMiddleware } from '../../../../../shared-kernel/infrastructure/trace-context.js';

const TID = '4bf92f3577b34da6a3ce929d0e0e4736';

function capturingFetch(body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  };
  return { fn, calls };
}

const opts = { retry: { maxRetries: 0, timeoutMs: 1000 }, circuitBreakerOptions: { failureThreshold: 100 } };

function inTrace(fn) {
  return runWithContext({}, () =>
    new Promise((resolve, reject) => {
      traceContextMiddleware()(
        { headers: { traceparent: `00-${TID}-00f067aa0ba902b7-01` } },
        { setHeader() {} },
        () => Promise.resolve().then(fn).then(resolve, reject),
      );
    }),
  );
}

describe('AI adapters propagate traceparent', () => {
  test('Anthropic healthCheck carries traceparent inside a request', async () => {
    const { fn, calls } = capturingFetch({ content: [], usage: {} });
    const p = new AnthropicProvider({ apiKey: 'k', model: 'm', fetch: fn, ...opts });
    await inTrace(() => p.healthCheck());
    expect(calls[0].headers.traceparent).toMatch(new RegExp(`^00-${TID}-[0-9a-f]{16}-01$`));
    expect(calls[0].headers['x-api-key']).toBe('k');
  });

  test('OpenAI healthCheck carries traceparent inside a request', async () => {
    const { fn, calls } = capturingFetch({ choices: [], usage: {} });
    const p = new OpenAIProvider({ apiKey: 'k', model: 'm', fetch: fn, ...opts });
    await inTrace(() => p.healthCheck());
    expect(calls[0].headers.traceparent).toMatch(new RegExp(`^00-${TID}-`));
  });

  test('no trace headers outside a request', async () => {
    const { fn, calls } = capturingFetch({ content: [], usage: {} });
    const p = new AnthropicProvider({ apiKey: 'k', model: 'm', fetch: fn, ...opts });
    await p.healthCheck();
    expect(calls[0].headers.traceparent).toBeUndefined();
  });
});
