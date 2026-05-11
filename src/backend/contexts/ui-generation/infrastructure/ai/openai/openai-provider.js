/**
 * openai-provider.js — OpenAI Chat Completions adapter for the AI ACL.
 *
 * Uses `fetch` directly (no vendor SDK) so the adapter is dependency-free.
 * Maps:
 *   - `generateUI` → POST /v1/chat/completions, JSON-mode response, then
 *     parse + validate against `UIDocumentDraft` schema.
 *   - `classify`   → POST /v1/chat/completions with a label-only prompt.
 *   - `healthCheck`→ POST /v1/chat/completions with a one-token canary.
 *
 * Error mapping:
 *   - HTTP 401/403            → AIProviderUnavailable (auth)
 *   - HTTP 429                → AIQuotaExceeded
 *   - HTTP 400 / 404 / 422    → AIInvalidRequest
 *   - HTTP 5xx, fetch failure → AIProviderUnavailable
 *   - Bad JSON / schema fail  → AIBadResponse
 */
import { BaseAIAdapter } from '../base-ai-adapter.js';
import {
  AIBadResponse,
  AIInvalidRequest,
  AIProviderUnavailable,
  AIQuotaExceeded,
} from '../domain-errors.js';
import { validateUIDocumentDraft } from '../ui-document-draft-schema.js';

const SYSTEM_PROMPT = [
  'You are a UI generator. Given a JSON UI specification and context,',
  'return ONLY a JSON object matching this exact schema:',
  '{',
  '  "layout": { "kind": "stack|grid|tabs|form", "regions": [{ "name": string, "fields": string[] }] },',
  '  "fields": [{ "id": string, "label": string, "type": "text|email|number|textarea|boolean|date|select",',
  '              "validations"?: [{ "id": string, "kind": string, "params"?: object }],',
  '              "component"?: { "name": string, "version"?: string },',
  '              "options"?: [{ "value": string, "label": string }] }]',
  '}',
  'No prose. No markdown. JSON only.',
].join('\n');

export class OpenAIProvider extends BaseAIAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} [opts.baseUrl]
   * @param {string} [opts.model]
   * @param {typeof fetch} [opts.fetch]
   * @param {object} [opts.retry]
   * @param {object} [opts.circuitBreakerOptions]
   * @param {object} [opts.logger]
   */
  constructor(opts) {
    super({
      logger: opts?.logger,
      retry: opts?.retry,
      circuitBreakerOptions: opts?.circuitBreakerOptions,
      scrubPii: opts?.scrubPii,
    });
    if (!opts?.apiKey) throw new Error('OpenAIProvider requires apiKey');
    this._apiKey = opts.apiKey;
    this._baseUrl = (opts.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
    this._model = opts.model ?? 'gpt-4o-mini';
    this._fetch = opts.fetch ?? globalThis.fetch;
    if (typeof this._fetch !== 'function') {
      throw new Error('OpenAIProvider: no fetch available (pass opts.fetch or use Node 18+)');
    }
  }

  get name() { return 'openai'; }
  get model() { return this._model; }

  async _callGenerateUI({ spec, context, strategyHints, signal }) {
    const body = {
      model: this._model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({ spec, context, strategyHints: strategyHints ?? null }),
        },
      ],
    };
    const data = await this._post('/v1/chat/completions', body, signal);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new AIBadResponse('OpenAI response missing message.content', { data });
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AIBadResponse('OpenAI returned non-JSON content', { content });
    }
    const draft = validateUIDocumentDraft(parsed);
    const usage = data.usage
      ? {
          prompt: data.usage.prompt_tokens ?? 0,
          completion: data.usage.completion_tokens ?? 0,
          total: data.usage.total_tokens ?? 0,
        }
      : undefined;
    return { ...draft, ...(usage ? { tokenUsage: usage } : {}) };
  }

  async _callClassify({ input, labels, options, signal }) {
    const body = {
      model: this._model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Classify the input. Respond with JSON of the form '
            + '{ "label": string, "confidence": number, "scores": {label: number} }. JSON only.',
        },
        {
          role: 'user',
          content: JSON.stringify({ input, labels, options: options ?? null }),
        },
      ],
    };
    const data = await this._post('/v1/chat/completions', body, signal);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new AIBadResponse('OpenAI classify response missing content');
    }
    let parsed;
    try { parsed = JSON.parse(content); } catch {
      throw new AIBadResponse('OpenAI classify returned non-JSON');
    }
    if (typeof parsed.label !== 'string' || typeof parsed.confidence !== 'number') {
      throw new AIBadResponse('OpenAI classify missing label/confidence');
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
    await this._post('/v1/chat/completions', body, signal);
    return { ok: true, latencyMs: Date.now() - start, model: this._model };
  }

  async _post(path, body, signal) {
    let res;
    try {
      res = await this._fetch(`${this._baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new AIProviderUnavailable(`OpenAI network error: ${err?.message ?? err}`, {
        cause: err?.message,
      });
    }
    if (!res.ok) {
      const text = await safeText(res);
      const status = res.status;
      const details = { status, body: truncate(text, 512) };
      if (status === 401 || status === 403) {
        throw new AIProviderUnavailable(`OpenAI auth failed (${status})`, details);
      }
      if (status === 429) {
        throw new AIQuotaExceeded('OpenAI rate limit / quota exceeded', details);
      }
      if (status >= 400 && status < 500) {
        throw new AIInvalidRequest(`OpenAI rejected request (${status})`, details);
      }
      throw new AIProviderUnavailable(`OpenAI server error (${status})`, details);
    }
    try {
      return await res.json();
    } catch (err) {
      throw new AIBadResponse(`OpenAI returned malformed JSON: ${err?.message ?? err}`);
    }
  }
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

function truncate(s, n) {
  if (typeof s !== 'string') return s;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
