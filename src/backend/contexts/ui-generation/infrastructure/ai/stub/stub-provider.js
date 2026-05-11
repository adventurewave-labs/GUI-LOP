/**
 * stub-provider.js — deterministic, zero-network `AIProvider` for dev mode
 * and tests. Echoes the supplied `spec` fields into a basic single-region
 * form layout. Never touches the network; the retry/circuit-breaker/PII
 * scrubbing wrappers from `BaseAIAdapter` still apply.
 *
 * This stub is independent of the legacy `StubUIGenerationService` used by
 * the Workflow Orchestration context (which speaks a different port). Both
 * can coexist; this stub implements the new `AIProvider` port from ADR
 * 0023.
 */
import { BaseAIAdapter } from '../base-ai-adapter.js';
import { validateUIDocumentDraft } from '../ui-document-draft-schema.js';

const TYPE_DEFAULTS = {
  text: 'text',
  email: 'email',
  number: 'number',
  textarea: 'textarea',
  boolean: 'boolean',
  date: 'date',
  select: 'select',
};

export class StubAIProvider extends BaseAIAdapter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.model]
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    super({ logger: opts.logger, scrubPii: false });
    this._model = opts.model ?? 'stub-v1';
    this.calls = [];
  }

  get name() { return 'stub'; }
  get model() { return this._model; }

  async _callGenerateUI({ spec, context, strategyHints }) {
    this.calls.push({ op: 'generateUI', spec, context, strategyHints });
    const fields = (spec?.fields ?? []).map((f) => ({
      id: String(f.id ?? `field-${Math.random().toString(36).slice(2, 8)}`),
      label: String(f.label ?? f.id ?? 'Field'),
      type: TYPE_DEFAULTS[f.type?.value ?? f.type] ?? 'text',
      ...(Array.isArray(f.validations) && f.validations.length > 0
        ? { validations: f.validations.map((v) => ({
            id: String(v.id ?? `v-${Math.random().toString(36).slice(2, 8)}`),
            kind: String(v.kind ?? 'required'),
            params: v.params ?? {},
          })) }
        : {}),
      ...(f.options && Array.isArray(f.options) && f.options.length > 0
        ? { options: f.options.map((o) => ({ value: String(o.value ?? o), label: String(o.label ?? o.value ?? o) })) }
        : {}),
    }));
    const safeFields = fields.length > 0
      ? fields
      : [{ id: 'placeholder', label: 'Placeholder', type: 'text' }];
    const draft = {
      layout: {
        kind: spec?.layout?.kind ?? 'form',
        regions: [{ name: 'main', fields: safeFields.map((f) => f.id) }],
      },
      fields: safeFields,
      rationale: 'stub-generated',
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    };
    // Validate so the stub is held to the same contract as live adapters.
    validateUIDocumentDraft(draft);
    return draft;
  }

  async _callClassify({ input, labels }) {
    this.calls.push({ op: 'classify', input, labels });
    const label = Array.isArray(labels) && labels.length > 0 ? labels[0] : 'unknown';
    const scores = (Array.isArray(labels) ? labels : []).reduce((acc, l, i) => {
      acc[l] = i === 0 ? 1 : 0;
      return acc;
    }, {});
    return { label, confidence: 1, scores };
  }

  async _callHealthCheck() {
    return { ok: true, latencyMs: 0, model: this._model };
  }
}
