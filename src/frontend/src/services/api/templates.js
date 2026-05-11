/**
 * Workflow template HTTP wrappers — a thin convenience module that re-exports
 * the template-shaped endpoints from `workflows.js` so feature folders can
 * import the right vocabulary.
 */

import { workflowsApi } from './workflows.js';
import { request } from './client.js';

export const templatesApi = {
  list: workflowsApi.listTemplates.bind(workflowsApi),
  get: workflowsApi.getTemplate.bind(workflowsApi),

  /** POST /api/v1/workflows/templates — admin only on the backend. */
  async publish({ key, version, name, description, steps, defaultConfig }) {
    const env = await request('/api/v1/workflows/templates', {
      method: 'POST',
      body: {
        key,
        version,
        name,
        description,
        steps: steps ?? [],
        default_config: defaultConfig,
      },
    });
    if (env && typeof env === 'object' && 'data' in env) return env.data;
    return env;
  },

  /** POST /api/v1/workflows/templates/:key/deprecate */
  async deprecate(key, { version }) {
    const env = await request(
      `/api/v1/workflows/templates/${encodeURIComponent(key)}/deprecate`,
      {
        method: 'POST',
        body: { version },
      },
    );
    if (env && typeof env === 'object' && 'data' in env) return env.data;
    return env;
  },
};

export default templatesApi;
