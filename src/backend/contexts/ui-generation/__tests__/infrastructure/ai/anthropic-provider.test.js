/**
 * anthropic-provider.test.js — fake-fetch tests for the Anthropic adapter.
 *
 * NOTE: These tests NEVER call the real Anthropic API. They use a fake
 * `fetch` implementation that returns recorded fixture bodies. Live tests
 * are gated on `AI_PROVIDER_LIVE_TEST=true` and `AI_API_KEY=<real key>`
 * (run via a separate live-test harness, not this Jest suite).
 */
import { AnthropicProvider } from '../../../infrastructure/ai/anthropic/anthropic-provider.js';
import {
  AIBadResponse,
  AIInvalidRequest,
  AIProviderUnavailable,
  AIQuotaExceeded,
} from '../../../infrastructure/ai/domain-errors.js';

const FIXTURE_DRAFT = {
  layout: { kind: 'form', regions: [{ name: 'main', fields: ['name'] }] },
  fields: [{ id: 'name', label: 'Name', type: 'text' }],
};

function fakeFetchOk(body, { status = 200 } = {}) {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }));
}

function fakeFetchErr(status, body = { error: { message: 'nope' } }) {
  return jest.fn(async () => ({
    ok: false,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }));
}

function makeProvider(overrides = {}) {
  return new AnthropicProvider({
    apiKey: 'sk-ant-test',
    model: 'claude-haiku-4-5',
    fetch: overrides.fetch ?? fakeFetchOk({}),
    retry: { maxRetries: 0, timeoutMs: 1000 },
    circuitBreakerOptions: { failureThreshold: 100 },
    ...overrides,
  });
}

describe('AnthropicProvider — generateUI happy path', () => {
  test('parses recorded fixture into a UIDocumentDraft', async () => {
    const fetchFn = fakeFetchOk({
      content: [{ type: 'text', text: JSON.stringify(FIXTURE_DRAFT) }],
      usage: { input_tokens: 9, output_tokens: 11 },
    });
    const p = makeProvider({ fetch: fetchFn });
    const draft = await p.generateUI({ spec: { fields: [] }, context: {} });
    expect(draft.layout.kind).toBe('form');
    expect(draft.fields).toHaveLength(1);
    expect(draft.tokenUsage).toEqual({ prompt: 9, completion: 11, total: 20 });
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    expect(init.headers['anthropic-version']).toBeDefined();
  });
});

describe('AnthropicProvider — error mapping', () => {
  test('maps 401 to AIProviderUnavailable', async () => {
    const p = makeProvider({ fetch: fakeFetchErr(401) });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIProviderUnavailable);
  });

  test('maps 429 to AIQuotaExceeded', async () => {
    const p = makeProvider({ fetch: fakeFetchErr(429) });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIQuotaExceeded);
  });

  test('maps 400 to AIInvalidRequest', async () => {
    const p = makeProvider({ fetch: fakeFetchErr(400) });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIInvalidRequest);
  });

  test('maps 503 to AIProviderUnavailable', async () => {
    const p = makeProvider({ fetch: fakeFetchErr(503) });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIProviderUnavailable);
  });

  test('throws AIBadResponse when content[].text is not JSON', async () => {
    const fetchFn = fakeFetchOk({
      content: [{ type: 'text', text: 'plain prose, not JSON' }],
    });
    const p = makeProvider({ fetch: fetchFn });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIBadResponse);
  });

  test('throws AIBadResponse when response fails schema', async () => {
    const fetchFn = fakeFetchOk({
      content: [{ type: 'text', text: JSON.stringify({ layout: {}, fields: [] }) }],
    });
    const p = makeProvider({ fetch: fetchFn });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIBadResponse);
  });

  test('throws AIBadResponse when content array is missing', async () => {
    const fetchFn = fakeFetchOk({ content: [] });
    const p = makeProvider({ fetch: fetchFn });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIBadResponse);
  });

  test('maps fetch failure to AIProviderUnavailable', async () => {
    const fetchFn = jest.fn(async () => { throw new Error('dns'); });
    const p = makeProvider({ fetch: fetchFn });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIProviderUnavailable);
  });
});

describe('AnthropicProvider — classify', () => {
  test('parses label/confidence payload', async () => {
    const fetchFn = fakeFetchOk({
      content: [{ type: 'text', text: JSON.stringify({ label: 'spam', confidence: 0.8 }) }],
    });
    const p = makeProvider({ fetch: fetchFn });
    const out = await p.classify({ input: 'free money', labels: ['spam', 'ham'] });
    expect(out.label).toBe('spam');
    expect(out.confidence).toBeCloseTo(0.8);
  });
});

describe('AnthropicProvider — config', () => {
  test('requires apiKey', () => {
    expect(() => new AnthropicProvider({ fetch: () => {} })).toThrow(/apiKey/);
  });

  test('defaults to claude-haiku-4-5', () => {
    const p = new AnthropicProvider({ apiKey: 'k', fetch: () => {} });
    expect(p.model).toBe('claude-haiku-4-5');
  });
});
