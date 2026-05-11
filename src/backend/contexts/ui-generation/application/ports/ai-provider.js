/**
 * AIProvider — outbound port for the Anti-Corruption Layer described in
 * ADR 0023. Adapters live under `infrastructure/ai/<vendor>/` and translate
 * vendor request/response shapes and errors into the domain language.
 *
 * Contract:
 *
 *   generateUI({ spec, context, strategyHints }): Promise<UIDocumentDraft>
 *     - `spec` is a plain JSON form of `UISpecification` (the aggregate's
 *       `toJSON()` output) so this port stays decoupled from the domain
 *       classes (vendors don't need to import them).
 *     - `context` carries workflow- and step-level hints (locale, tenant,
 *       prior values). Free-form JSON object.
 *     - `strategyHints` is an optional `{ style?: string, density?: string,
 *       maxFields?: number }` bag.
 *     - Returns a `UIDocumentDraft`:
 *         {
 *           layout: { kind: 'stack'|'grid'|'tabs'|'form',
 *                     regions: [{ name: string, fields: string[] }] },
 *           fields: Array<{
 *             id: string,
 *             label: string,
 *             type: 'text'|'email'|'number'|'textarea'|'boolean'|'date'|'select',
 *             validations?: Array<{ id: string, kind: string, params?: object }>,
 *             component?: { name: string, version?: string },
 *             options?: Array<{ value: string, label: string }>
 *           }>,
 *           rationale?: string,
 *           tokenUsage?: { prompt: number, completion: number, total: number }
 *         }
 *     - The adapter MUST NOT return raw HTML. The schema is enforced by
 *       the adapter; non-conformant responses raise `AIBadResponse`.
 *
 *   classify({ input, labels, options? }): Promise<ClassificationResult>
 *     - `input`: string to classify (or array of strings — adapter decides
 *       whether to batch).
 *     - `labels`: candidate label strings.
 *     - `options`: `{ multiLabel?: boolean, threshold?: number }`.
 *     - Returns `{ label: string, confidence: number, scores?: Record<string, number> }`.
 *
 *   healthCheck(): Promise<{ ok: boolean, latencyMs: number, model: string }>
 *     - Cheap round-trip probe. Adapters MAY use a tiny canary prompt.
 *
 * Errors thrown by adapters MUST be one of the AI domain errors defined in
 * `infrastructure/ai/domain-errors.js`:
 *   - `AIProviderUnavailable` — network/5xx/auth failures.
 *   - `AIQuotaExceeded`       — 429 / quota / rate-limit responses.
 *   - `AIInvalidRequest`      — vendor-rejected request shape (400 etc.).
 *   - `AIBadResponse`         — vendor returned a malformed or schema-
 *                                non-conformant body.
 *
 * @typedef {object} UIDocumentDraft
 * @property {{ kind: string, regions: Array<{ name: string, fields: string[] }> }} layout
 * @property {Array<object>} fields
 * @property {string} [rationale]
 * @property {{ prompt: number, completion: number, total: number }} [tokenUsage]
 *
 * @typedef {object} ClassificationResult
 * @property {string} label
 * @property {number} confidence
 * @property {Record<string, number>} [scores]
 */
export class AIProvider {
  // eslint-disable-next-line no-unused-vars
  async generateUI(_input) {
    throw new Error('AIProvider.generateUI is abstract');
  }

  // eslint-disable-next-line no-unused-vars
  async classify(_input) {
    throw new Error('AIProvider.classify is abstract');
  }

  async healthCheck() {
    throw new Error('AIProvider.healthCheck is abstract');
  }
}
