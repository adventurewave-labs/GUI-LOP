/**
 * Port to the UI Generation context.
 *
 * @typedef {object} UIGenerationService
 * @property {(input: {
 *   workflowId: string,
 *   stepId: string,
 *   uiSpec: object,
 *   context: object,
 * }) => Promise<{ uiDocumentId: string, url: string }>} generateForStep
 */

/** Minimal stub that returns a deterministic fake URL. */
export class StubUIGenerationService {
  constructor({ baseUrl = 'http://localhost:8501' } = {}) {
    this.baseUrl = baseUrl;
    this.calls = [];
  }
  async generateForStep({ workflowId, stepId }) {
    const out = {
      uiDocumentId: `ui-${workflowId}-${stepId}`,
      url: `${this.baseUrl}/${workflowId}/${stepId}`,
    };
    this.calls.push(out);
    return out;
  }
}
