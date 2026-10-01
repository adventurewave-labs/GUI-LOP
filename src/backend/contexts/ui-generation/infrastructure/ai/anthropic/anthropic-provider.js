/**
 * anthropic-provider.js — Anthropic Messages API adapter for the AI ACL.
 *
 * Uses `fetch` directly (no vendor SDK). Default model `claude-haiku-4-5`
 * (fast/cheap tier); override with AI_MODEL, and AI_MODEL_CLASSIFY for the
 * classification op.
 *
 * Structured output: generation and classification use *forced tool use*
 * (`tool_choice: { type: 'tool' }`) with a JSON Schema `input_schema`, so the
 * model emits a typed `tool_use` block instead of free text that has to be
 * JSON.parse'd. A plain-text JSON fallback remains for proxies/gateways that
 * strip tools. The validator still runs on every response.
 *
 * Prompt caching: the static prefix (tool definition + system prompt) is
 * marked `cache_control: ephemeral`. Anthropic only caches prefixes above a
 * model-specific minimum token count, so the effect depends on prompt size;
 * `cacheRead` / `cacheWrite` in token usage show whether it engaged.
 *
 * Maps the same operations as the OpenAI adapter to Anthropic's
 * `/v1/messages` endpoint and translates errors into the AI domain error
 * taxonomy.
 *
 * Error mapping:
 *   - HTTP 401/403            → AIProviderUnavailable (auth)
 *   - HTTP 429                → AIQuotaExceeded
 *   - HTTP 400 / 404 / 422    → AIInvalidRequest
 *   - HTTP 5xx, fetch failure → AIProviderUnavailable
 *   - Bad JSON / schema fail  → AIBadResponse
 */
import { outboundTraceHeaders } from '../../../../../shared-kernel/infrastructure/trace-context.js';
import { BaseAIAdapter } from '../base-ai-adapter.js';
import {
  AIBadResponse,
  AIInvalidRequest,
  AIProviderUnavailable,
  AIQuotaExceeded,
} from '../domain-errors.js';
import {
  validateUIDocumentDraft,
  UI_DOCUMENT_DRAFT_JSON_SCHEMA,
  classificationJsonSchema,
  normaliseUsage,
} from '../ui-document-draft-schema.js';

const EPHEMERAL = Object.freeze({ type: 'ephemeral' });
const UI_TOOL = Object.freeze({
  name: 'emit_ui_document',
  description: 'Emit the generated UI document draft.',
  input_schema: UI_DOCUMENT_DRAFT_JSON_SCHEMA,
  cache_control: EPHEMERAL,
});
const CLASSIFY_SYSTEM = 'Classify the input into one of the given labels. '
  + 'Call emit_classification with label, confidence (0-1) and optional per-label scores.';

const SYSTEM_PROMPT = [
  'You are a UI generator. Given a JSON UI specification and context,',
  'return ONLY a JSON object matching this schema:',
  '{ "layout": { "kind": "stack|grid|tabs|form", "regions": [{ "name": string, "fields": string[] }] },',
  '  "fields": [{ "id": string, "label": string,',
  '              "type": "text|email|number|textarea|boolean|date|select",',
  '              "validations"?: [{ "id": string, "kind": string, "params"?: object }],',
  '              "component"?: { "name": string, "version"?: string },',
  '              "options"?: [{ "value": string, "label": string }] }] }',
  'No prose. No markdown. JSON only.',
].join('\n');

const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicProvider extends BaseAIAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} [opts.baseUrl]
   * @param {string} [opts.model]   Defaults to claude-haiku-4-5.
   * @param {typeof fetch} [opts.fetch]
   * @param {object} [opts.retry]
   * @param {object} [opts.circuitBreakerOptions]
   * @param {object} [opts.logger]
   * @param {number} [opts.maxTokens]
   * @param {string} [opts.classifyModel]  Model for classify (defaults to `model`).
   */
  constructor(opts) {
    super({
      logger: opts?.logger,
      onTelemetry: opts?.onTelemetry,
      retry: opts?.retry,
      circuitBreakerOptions: opts?.circuitBreakerOptions,
      scrubPii: opts?.scrubPii,
    });
    if (!opts?.apiKey) throw new Error('AnthropicProvider requires apiKey');
    this._apiKey = opts.apiKey;
    this._baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    this._model = opts.model ?? 'claude-haiku-4-5';
    this._classifyModel = opts.classifyModel ?? this._model;
    this._maxTokens = opts.maxTokens ?? 2048;
    this._fetch = opts.fetch ?? globalThis.fetch;
    if (typeof this._fetch !== 'function') {
      throw new Error('AnthropicProvider: no fetch available (pass opts.fetch or use Node 18+)');
    }
  }

  get name() { return 'anthropic'; }
  get model() { return this._model; }

  async _callGenerateUI({ spec, context, strategyHints, signal }) {
    const body = {
      model: this._model,
      max_tokens: this._maxTokens,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: EPHEMERAL }],
      tools: [UI_TOOL],
      tool_choice: { type: 'tool', name: UI_TOOL.name },
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ spec, context, strategyHints: strategyHints ?? null }),
        },
      ],
    };
    const data = await this._post('/v1/messages', body, signal);
    const draft = validateUIDocumentDraft(extractStructured(data, UI_TOOL.name));
    const usage = normaliseUsage(data.usage);
    return { ...draft, ...(usage ? { tokenUsage: usage } : {}) };
  }

  async _callClassify({ input, labels, options, signal }) {
    const tool = {
      name: 'emit_classification',
      description: 'Emit the classification result.',
      input_schema: classificationJsonSchema(labels),
    };
    const body = {
      model: this._classifyModel,
      max_tokens: 256,
      system: CLASSIFY_SYSTEM,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ input, labels, options: options ?? null }),
        },
      ],
    };
    const data = await this._post('/v1/messages', body, signal);
    const parsed = extractStructured(data, tool.name);
    if (typeof parsed?.label !== 'string' || typeof parsed?.confidence !== 'number') {
      throw new AIBadResponse('Anthropic classify missing label/confidence');
    }
    if (Array.isArray(labels) && labels.length > 0 && !labels.includes(parsed.label)) {
      throw new AIBadResponse('Anthropic classify returned a label outside the allowed set', { label: parsed.label });
    }
    return parsed;
  }

  async _callHealthCheck({ signal }) {
    const start = Date.now();
    const body = {
      model: this._model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    };
    await this._post('/v1/messages', body, signal);
    return { ok: true, latencyMs: Date.now() - start, model: this._model };
  }

  async _post(path, body, signal) {
    let res;
    try {
      res = await this._fetch(`${this._baseUrl}${path}`, {
        method: 'POST',
        headers: {
          // W3C trace propagation (no-op outside a request).
          ...outboundTraceHeaders(),
          'Content-Type': 'application/json',
          'x-api-key': this._apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new AIProviderUnavailable(`Anthropic network error: ${err?.message ?? err}`, {
        cause: err?.message,
      });
    }
    if (!res.ok) {
      const text = await safeText(res);
      const status = res.status;
      const details = { status, body: truncate(text, 512) };
      if (status === 401 || status === 403) {
        throw new AIProviderUnavailable(`Anthropic auth failed (${status})`, details);
      }
      if (status === 429) {
        throw new AIQuotaExceeded('Anthropic rate limit / quota exceeded', details);
      }
      if (status >= 400 && status < 500) {
        throw new AIInvalidRequest(`Anthropic rejected request (${status})`, details);
      }
      throw new AIProviderUnavailable(`Anthropic server error (${status})`, details);
    }
    try {
      return await res.json();
    } catch (err) {
      throw new AIBadResponse(`Anthropic returned malformed JSON: ${err?.message ?? err}`);
    }
  }
}

/**
 * Prefer the forced `tool_use` block's typed input; fall back to a JSON text
 * block (gateways that strip tools, or recorded fixtures).
 */
function extractStructured(data, toolName) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const tool = blocks.find((b) => b?.type === 'tool_use' && b.name === toolName);
  if (tool && tool.input && typeof tool.input === 'object') return tool.input;
  const text = extractText(data);
  try {
    return JSON.parse(text);
  } catch {
    throw new AIBadResponse('Anthropic returned non-JSON content', { text: truncate(text, 256) });
  }
}

function extractText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const piece = blocks.find((b) => b?.type === 'text') ?? blocks[0];
  if (!piece || typeof piece.text !== 'string') {
    throw new AIBadResponse('Anthropic response has no text content', { data });
  }
  return piece.text;
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

function truncate(s, n) {
  if (typeof s !== 'string') return s;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
