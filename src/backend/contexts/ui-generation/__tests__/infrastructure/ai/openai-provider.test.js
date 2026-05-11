/**
 * openai-provider.test.js — fake-fetch tests for the OpenAI adapter.
 *
 * NOTE: These tests NEVER call the real OpenAI API. They use a fake `fetch`
 * implementation that returns recorded fixture bodies.
 *
 * Live tests against the real API are intentionally not included here. To
 * run against a live endpoint, set `AI_PROVIDER_LIVE_TEST=true` and
 * `AI_API_KEY=<real key>` and run a separate live-test harness.
 */
import { OpenAIProvider } from '../../../infrastructure/ai/openai/openai-provider.js';
import {
  AIBadResponse,
  AIInvalidRequest,
  AIProviderUnavailable,
  AIQuotaExceeded,
} from '../../../infrastructure/ai/domain-errors.js';

const FIXTURE_DRAFT = {
  layout: { kind: 'form', regions: [{ name: 'main', fields: ['name', 'email'] }] },
  fields: [
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'email', label: 'Email', type: 'email', validations: [{ id: 'v1', kind: 'required' }] },
  ],
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
  return new OpenAIProvider({
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
    fetch: overrides.fetch ?? fakeFetchOk({}),
    retry: { maxRetries: 0, timeoutMs: 1000 },
    circuitBreakerOptions: { failureThreshold: 100 },
    ...overrides,
  });
}

describe('OpenAIProvider — generateUI happy path', () => {
  test('parses recorded fixture into a UIDocumentDraft', async () => {
    const fetchFn = fakeFetchOk({
      choices: [{ message: { content: JSON.stringify(FIXTURE_DRAFT) } }],
      usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
    });
    const p = makeProvider({ fetch: fetchFn });
    const draft = await p.generateUI({ spec: { fields: [] }, context: {} });
    expect(draft.layout.kind).toBe('form');
    expect(draft.fields).toHaveLength(2);
    expect(draft.tokenUsage).toEqual({ prompt: 10, completion: 12, total: 22 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer sk-test');
  });
});

describe('OpenAIProvider — error mapping', () => {
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

  test('maps 500 to AIProviderUnavailable', async () => {
    const p = makeProvider({ fetch: fakeFetchErr(500) });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIProviderUnavailable);
  });

  test('throws AIBadResponse on malformed JSON content', async () => {
    const fetchFn = fakeFetchOk({
      choices: [{ message: { content: 'this is not JSON at all' } }],
    });
    const p = makeProvider({ fetch: fetchFn });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIBadResponse);
  });

  test('throws AIBadResponse when response fails schema', async () => {
    const fetchFn = fakeFetchOk({
      choices: [{ message: { content: JSON.stringify({ layout: { kind: 'invalid' }, fields: [] }) } }],
    });
    const p = makeProvider({ fetch: fetchFn });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIBadResponse);
  });

  test('throws AIProviderUnavailable when fetch itself throws', async () => {
    const fetchFn = jest.fn(async () => { throw new Error('network down'); });
    const p = makeProvider({ fetch: fetchFn });
    await expect(p.generateUI({ spec: { fields: [] }, context: {} }))
      .rejects.toBeInstanceOf(AIProviderUnavailable);
  });
});

describe('OpenAIProvider — classify', () => {
  test('parses the label/confidence payload', async () => {
    const fetchFn = fakeFetchOk({
      choices: [{ message: { content: JSON.stringify({ label: 'fraud', confidence: 0.97, scores: { fraud: 0.97, ok: 0.03 } }) } }],
    });
    const p = makeProvider({ fetch: fetchFn });
    const out = await p.classify({ input: 'suspicious', labels: ['fraud', 'ok'] });
    expect(out.label).toBe('fraud');
    expect(out.confidence).toBeCloseTo(0.97);
  });
});

describe('OpenAIProvider — config', () => {
  test('requires apiKey', () => {
    expect(() => new OpenAIProvider({ fetch: () => {} })).toThrow(/apiKey/);
  });
});
