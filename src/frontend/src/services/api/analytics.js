/**
 * Audit & Analytics HTTP wrappers — `/api/v1/analytics/*` and
 * `/api/v1/dashboards/*`.
 */

import { request } from './client.js';

function unwrap(env) {
  if (env && typeof env === 'object' && 'data' in env) return env.data;
  return env;
}

export const analyticsApi = {
  /** GET /api/v1/analytics/workflows */
  async workflows({ from, to, templateKey } = {}) {
    return unwrap(
      await request('/api/v1/analytics/workflows', {
        query: { from, to, template_key: templateKey },
      }),
    );
  },

  /** GET /api/v1/analytics/users/:id */
  async userActivity(userId) {
    return unwrap(
      await request(`/api/v1/analytics/users/${encodeURIComponent(userId)}`),
    );
  },
};

export const dashboardsApi = {
  /** GET /api/v1/dashboards/active-workflows */
  async activeWorkflows() {
    return unwrap(await request('/api/v1/dashboards/active-workflows'));
  },
};

export default analyticsApi;
