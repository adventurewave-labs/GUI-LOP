/**
 * structured-output.test.js — offline (fake fetch) checks that both vendor
 * adapters request schema-constrained output, prefer the structured result,
 * enforce label sets, report normalised usage, and feed metrics.
 * No network, no paid calls.
 */
import { AnthropicProvider } from '../../../infrastructure/ai/anthropic/anthropic-provider.js';
import { OpenAIProvider } from '../../../infrastructure/ai/openai/openai-provider.js';
import {
  UI_DOCUMENT_DRAFT_JSON_SCHEMA,
  normaliseUsage,
} from '../../../infrastructure/ai/ui-document-draft-schema.js';
import { AIBadResponse } from '../../../infrastructure/ai/domain-errors.js';
import { createMetrics } from '../../../../../bootstrap/metrics.js';

const DRAFT = {
  layout: { kind: 'form', regions: [{ name: 'main', fields: ['email'] }] },
  fields: [{ id: 'email', label: 'Email', type: 'email' }],
};
const common = { apiKey: 'k', retry: { maxRetries: 0, timeoutMs: 1000 }, circuitBreakerOptions: { failureThreshold: 100 } };

function fakeFetch(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => response, text: async () => JSON.stringify(response) };
  };
  return { fn, calls };
}

describe('Anthropic structured output', () => {
  test('generateUI forces the emit_ui_document tool with the draft JSON Schema + caching', async () => {
    const { fn, calls } = fakeFetch({
      content: [{ type: 'tool_use', name: 'emit_ui_document', input: DRAFT }],
      usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    });
    const p = new AnthropicProvider({ ...common, model: 'claude-haiku-4-5', fetch: fn });
    const out = await p.generateUI({ spec: { fields: [] }, context: {} });

    const body = calls[0].body;
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'emit_ui_document' });
    expect(body.tools[0].input_schema).toEqual(UI_DOCUMENT_DRAFT_JSON_SCHEMA);
    expect(body.tools[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });

    expect(out.fields[0].id).toBe('email');
    expect(out.tokenUsage).toEqual({ prompt: 1200, completion: 80, total: 2280, cacheRead: 1000 });
  });

  test('text-JSON fallback still works (gateway stripped tools)', async () => {
    const { fn } = fakeFetch({ content: [{ type: 'text', text: JSON.stringify(DRAFT) }] });
    const p = new AnthropicProvider({ ...common, fetch: fn });
    await expect(p.generateUI({ spec: {}, context: {} })).resolves.toEqual(expect.objectContaining({ fields: DRAFT.fields }));
  });

  test('schema-constrained output is still validated (never trust the model)', async () => {
    const { fn } = fakeFetch({ content: [{ type: 'tool_use', name: 'emit_ui_document', input: { layout: { kind: 'carousel', regions: [] }, fields: [] } }] });
    const p = new AnthropicProvider({ ...common, fetch: fn });
    await expect(p.generateUI({ spec: {}, context: {} })).rejects.toBeInstanceOf(AIBadResponse);
  });

  test('classify uses classifyModel, an enum of labels, and rejects out-of-set labels', async () => {
    const ok = fakeFetch({ content: [{ type: 'tool_use', name: 'emit_classification', input: { label: 'urgent', confidence: 0.9 } }] });
    const p = new AnthropicProvider({ ...common, model: 'big', classifyModel: 'small', fetch: ok.fn });
    await expect(p.classify({ input: 'x', labels: ['urgent', 'normal'] })).resolves.toEqual(expect.objectContaining({ label: 'urgent' }));
    expect(ok.calls[0].body.model).toBe('small');
    expect(ok.calls[0].body.tools[0].input_schema.properties.label.enum).toEqual(['urgent', 'normal']);

    const bad = fakeFetch({ content: [{ type: 'tool_use', name: 'emit_classification', input: { label: 'spam', confidence: 0.9 } }] });
    const p2 = new AnthropicProvider({ ...common, fetch: bad.fn });
    await expect(p2.classify({ input: 'x', labels: ['urgent', 'normal'] })).rejects.toBeInstanceOf(AIBadResponse);
  });
});

describe('OpenAI structured output', () => {
  test('generateUI requests response_format json_schema with the shared schema', async () => {
    const { fn, calls } = fakeFetch({
      choices: [{ message: { content: JSON.stringify(DRAFT) } }],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70, prompt_tokens_details: { cached_tokens: 32 } },
    });
    const p = new OpenAIProvider({ ...common, fetch: fn });
    const out = await p.generateUI({ spec: {}, context: {} });
    expect(calls[0].body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'ui_document_draft', schema: UI_DOCUMENT_DRAFT_JSON_SCHEMA, strict: false },
    });
    expect(out.tokenUsage).toEqual({ prompt: 50, completion: 20, total: 70, cacheRead: 32 });
  });

  test('classify constrains labels and uses classifyModel', async () => {
    const { fn, calls } = fakeFetch({ choices: [{ message: { content: '{"label":"b","confidence":0.5}' } }] });
    const p = new OpenAIProvider({ ...common, classifyModel: 'mini', fetch: fn });
    await p.classify({ input: 'x', labels: ['a', 'b'] });
    expect(calls[0].body.model).toBe('mini');
    expect(calls[0].body.response_format.json_schema.schema.properties.label.enum).toEqual(['a', 'b']);
  });
});

describe('telemetry → metrics (loop 4 regressions)', () => {
  test('real vendor adapters forward onTelemetry and tokens are counted', async () => {
    const m = createMetrics({ defaultMetrics: false });
    const { fn } = fakeFetch({
      content: [{ type: 'tool_use', name: 'emit_ui_document', input: DRAFT }],
      usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 40 },
    });
    const p = new AnthropicProvider({ ...common, model: 'claude-haiku-4-5', fetch: fn, onTelemetry: m.onAITelemetry });
    await p.generateUI({ spec: {}, context: {} });
    const text = await m.registry.metrics();
    expect(text).toMatch(/ai_call_duration_seconds_count\{provider="anthropic",model="claude-haiku-4-5",op="generate_ui",outcome="ok"\} 1/);
    expect(text).toMatch(/ai_tokens_total\{provider="anthropic",model="claude-haiku-4-5",direction="input"\} 100/);
    expect(text).toMatch(/direction="output"\} 10/);
    expect(text).toMatch(/direction="cache_read"\} 40/);
  });

  test('normaliseUsage handles both vendors and absence', () => {
    expect(normaliseUsage(undefined)).toBeUndefined();
    expect(normaliseUsage({ input_tokens: 3, output_tokens: 2 })).toEqual({ prompt: 3, completion: 2, total: 5 });
    expect(normaliseUsage({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 })).toEqual({ prompt: 3, completion: 2, total: 5 });
  });
});
