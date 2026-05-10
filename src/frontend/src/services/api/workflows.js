/**
 * Workflow Orchestration HTTP wrappers — `/api/v1/workflows/*`.
 *
 * The backend returns `{ success, data: { ... } }` envelopes. We unwrap the
 * `data` field for ergonomic call-sites; raw envelopes are still available
 * via the underlying `request()` if needed.
 */

import { request } from './client.js';

function unwrap(envelope) {
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    return envelope.data;
  }
  return envelope;
}

export const workflowsApi = {
  /** GET /api/v1/workflows/templates */
  async listTemplates({ activeOnly } = {}) {
    const env = await request('/api/v1/workflows/templates', {
      query: activeOnly ? { active: 'true' } : undefined,
    });
    const data = unwrap(env);
    return Array.isArray(data?.templates) ? data.templates : data?.templates ?? [];
  },

  /** GET /api/v1/workflows/templates/:key */
  async getTemplate(key, { version } = {}) {
    const env = await request(`/api/v1/workflows/templates/${encodeURIComponent(key)}`, {
      query: version != null ? { version } : undefined,
    });
    const data = unwrap(env);
    return data?.template ?? data;
  },

  /** GET /api/v1/workflows/active */
  async listActive({ userId, templateKey } = {}) {
    const env = await request('/api/v1/workflows/active', {
      query: { user_id: userId, template_key: templateKey },
    });
    const data = unwrap(env);
    return data?.workflows ?? [];
  },

  /** GET /api/v1/workflows/:id */
  async getDetail(workflowId) {
    const env = await request(`/api/v1/workflows/${encodeURIComponent(workflowId)}`);
    const data = unwrap(env);
    return data?.workflow ?? data;
  },

  /** POST /api/v1/workflows */
  async create({ template, templateVersion, context, idempotencyKey } = {}) {
    const env = await request('/api/v1/workflows', {
      method: 'POST',
      body: {
        template,
        template_version: templateVersion,
        context: context ?? {},
      },
      idempotencyKey,
    });
    return unwrap(env);
  },

  /** POST /api/v1/workflows/:id/execute */
  async execute(workflowId, { idempotencyKey } = {}) {
    const env = await request(
      `/api/v1/workflows/${encodeURIComponent(workflowId)}/execute`,
      {
        method: 'POST',
        body: {},
        idempotencyKey,
      },
    );
    return unwrap(env);
  },

  /** POST /api/v1/workflows/:id/cancel */
  async cancel(workflowId, { reason } = {}) {
    const env = await request(
      `/api/v1/workflows/${encodeURIComponent(workflowId)}/cancel`,
      {
        method: 'POST',
        body: { reason },
      },
    );
    return unwrap(env);
  },
};

export default workflowsApi;
