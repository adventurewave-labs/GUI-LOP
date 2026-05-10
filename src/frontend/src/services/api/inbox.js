/**
 * Human Interaction HTTP wrappers — `/api/v1/inbox/*` and the
 * `POST /api/v1/workflows/:id/respond` endpoint that records human input.
 *
 * Backend returns either `{ data: ... }` or a raw payload depending on the
 * route; we normalise to the inner payload for callers.
 */

import { request } from './client.js';

function unwrap(env) {
  if (env && typeof env === 'object' && 'data' in env) return env.data;
  return env;
}

export const inboxApi = {
  /** GET /api/v1/inbox — pending steps for the current user. */
  async listPending() {
    const env = await request('/api/v1/inbox');
    const data = unwrap(env);
    return Array.isArray(data) ? data : data ?? [];
  },

  /** GET /api/v1/inbox/:workflowId/:stepId */
  async getPendingStep(workflowId, stepId) {
    const env = await request(
      `/api/v1/inbox/${encodeURIComponent(workflowId)}/${encodeURIComponent(stepId)}`,
    );
    return unwrap(env);
  },

  /** POST /api/v1/workflows/:id/respond — submit a human response. */
  async respond({ workflowId, stepId, action, payload, rationale, confidence, idempotencyKey }) {
    const env = await request(
      `/api/v1/workflows/${encodeURIComponent(workflowId)}/respond`,
      {
        method: 'POST',
        body: {
          step_id: stepId,
          action,
          payload: payload ?? {},
          rationale,
          confidence,
        },
        idempotencyKey,
      },
    );
    return unwrap(env);
  },
};

export default inboxApi;
