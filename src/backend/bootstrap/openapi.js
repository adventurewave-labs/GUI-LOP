// @ts-check
/**
 * OpenAPI 3.1 description of the public HTTP API (roadmap 22 / P8), served at
 * GET /api/v1/openapi.json.
 *
 * Kept honest by tests, not by discipline:
 *   - the path/method set must equal the routes Express actually serves
 *     (a new or renamed route fails the build until it is described here);
 *   - real responses from the booted app are validated against these schemas.
 *
 * Schemas use JSON Schema 2020-12 (OpenAPI 3.1). `additionalProperties` is
 * left open on purpose: adding a response field is not a breaking change.
 */

const json = (schema, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const problem = (description) => ({ description, content: { 'application/problem+json': { schema: ref('Problem') } } });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const envelope = (data) => obj({ success: { const: true }, data }, ['success', 'data']);
const str = { type: 'string' };
const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });
const uuid = { type: 'string', format: 'uuid' };
const dateTime = { type: 'string', format: 'date-time' };
const pathParam = (name, schema = str, description) => ({ name, in: 'path', required: true, schema, ...(description ? { description } : {}) });
const anyObject = { type: 'object' };

const ERR = {
  400: problem('Invalid request'),
  401: problem('Missing, invalid, expired or revoked credentials'),
  403: problem('Authenticated but not allowed'),
  404: problem('Not found'),
  409: problem('Conflict with the current state (or an in-flight Idempotency-Key)'),
  412: problem('If-Match did not match the current version'),
  422: problem('Semantically invalid (or Idempotency-Key reused with a different body)'),
  429: problem('Rate limited; see Retry-After / RateLimit headers'),
  503: problem('Temporarily unavailable; retry after Retry-After seconds'),
};
const errs = (...codes) => Object.fromEntries(codes.map((c) => [String(c), ERR[c]]));

const idempotencyKey = {
  name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 255 },
  description: 'Makes the request safe to retry: the first response is replayed (Idempotent-Replayed: true); a concurrent duplicate gets 409; a different body gets 422.',
};
const ifMatch = {
  name: 'If-Match', in: 'header', required: false, schema: str,
  description: 'Strong ETag from GET /workflows/{id}; 412 with current_version if the workflow changed since.',
};
const paging = [
  { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
  { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0 } },
];

const bearer = [{ bearerAuth: [] }, { apiKeyAuth: [] }];
const op = (tag, summary, rest) => ({ tags: [tag], summary, security: bearer, ...rest });
const publicOp = (tag, summary, rest) => ({ tags: [tag], summary, security: [], ...rest });

/**
 * @param {{ version?: string|null }} [opts]
 */
export function buildOpenApiDocument({ version } = {}) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'GUI-LOP API',
      version: version || '1.0.0',
      description: 'Generative UI & Human-in-the-Loop Orchestration Platform. Errors are RFC 9457 problem documents (application/problem+json).',
    },
    servers: [{ url: '/' }],
    tags: ['auth', 'api-keys', 'admin', 'workflows', 'templates', 'human-interaction', 'ui', 'notifications', 'audit', 'operations'].map((name) => ({ name })),
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token from /api/v1/auth/login (15 min).' },
        apiKeyAuth: { type: 'http', scheme: 'bearer', description: 'API key minted at /api/v1/auth/api-keys; its permission list is a ceiling.' },
      },
      schemas: {
        Problem: {
          type: 'object',
          description: 'RFC 9457 problem details plus legacy envelope members.',
          properties: {
            type: { type: 'string' }, title: str, status: { type: 'integer' }, detail: str, instance: str,
            code: str, request_id: str, field: str, reason: str, current_version: { type: 'integer' },
          },
          required: ['type', 'title', 'status'],
        },
        User: obj({ id: uuid, email: str, username: str, role: { enum: ['admin', 'user', 'viewer'] } }),
        Me: obj({
          id: uuid, email: str, username: str, role: str, fullName: nullable(str), isActive: { type: 'boolean' },
          createdAt: dateTime, updatedAt: dateTime, lastLogin: nullable(dateTime),
        }, ['id', 'email', 'username', 'role', 'isActive']),
        Tokens: obj({
          accessToken: str, refreshToken: str, accessTokenExpiresAt: dateTime, refreshTokenExpiresAt: dateTime, sessionId: uuid,
        }),
        Login: { allOf: [ref('Tokens'), obj({ user: ref('User') })] },
        TemplateStep: obj({ name: str, kind: { enum: ['automated', 'human', 'external'] } }),
        Template: obj({
          template_key: str, version: { type: 'integer' }, name: str, description: nullable(str),
          status: { enum: ['draft', 'published', 'deprecated'] }, steps: { type: 'array', items: ref('TemplateStep') },
        }, ['template_key', 'version', 'name', 'status', 'steps']),
        WorkflowStatus: { enum: ['created', 'running', 'waiting_for_human', 'completed', 'failed', 'cancelled'] },
        WorkflowStep: obj({ id: uuid, name: str, kind: str, order: { type: 'integer' }, status: str }),
        Workflow: obj({
          id: uuid, template_key: str, template_version: { type: 'integer' }, status: ref('WorkflowStatus'),
          context: anyObject, steps: { type: 'array', items: ref('WorkflowStep') }, version: { type: 'integer' },
        }, ['id', 'template_key', 'status', 'steps']),
        AuditIntegrity: obj({ supported: { type: 'boolean' }, ok: { type: 'boolean' }, entries: { type: 'integer' }, firstBrokenSeq: { type: ['integer', 'null'] }, head: { type: ['object', 'null'] } }),
        PendingStep: obj({
          workflowId: uuid, stepId: uuid, uiDocumentId: nullable(str),
          eligibility: obj({ requiredRole: nullable(str), requiredPermissions: { type: 'array', items: str }, scope: nullable(str) }),
          deadline: nullable(dateTime), onTimeout: str, escalationLevel: { type: 'integer' }, openedAt: dateTime, closedAt: nullable(dateTime),
        }, ['workflowId', 'stepId', 'eligibility', 'openedAt']),
      },
    },
    paths: {
      '/livez': { get: publicOp('operations', 'Liveness (process is up); reports the deployed commit as `version` when known', { responses: { 200: json(obj({ status: { const: 'ok' }, version: str }, ['status'])) } }) },
      '/readyz': { get: publicOp('operations', 'Readiness (dependencies reachable; 503 while draining)', { responses: { 200: json(obj({ status: str, checks: anyObject })), 503: json(obj({ status: str, checks: anyObject }), 'Not ready') } }) },
      '/health': { get: publicOp('operations', 'Legacy health endpoint (prefer /livez and /readyz)', { responses: { 200: json(anyObject), 503: json(anyObject, 'Unhealthy') } }) },
      '/metrics': { get: { tags: ['operations'], summary: 'Prometheus metrics (Bearer METRICS_TOKEN; 404 in production when no token is configured)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Prometheus text exposition', content: { 'text/plain': { schema: str } } }, 401: { description: 'Missing or wrong token' }, 404: { description: 'Metrics disabled' } } } },
      '/api/v1/openapi.json': { get: publicOp('operations', 'This document', { responses: { 200: json(anyObject) } }) },

      '/api/v1/auth/register': { post: publicOp('auth', 'Create an account', {
        parameters: [idempotencyKey],
        requestBody: { required: true, content: { 'application/json': { schema: obj({ email: { type: 'string', format: 'email' }, username: { type: 'string', minLength: 3, maxLength: 30 }, password: { type: 'string', minLength: 15, maxLength: 128, description: 'NIST 800-63B: length only, checked against a common-password blocklist.' }, fullName: str }, ['email', 'username', 'password']) } } },
        responses: { 201: json(ref('User'), 'Created'), ...errs(400, 409, 429) },
      }) },
      '/api/v1/auth/login': { post: publicOp('auth', 'Exchange credentials for an access + refresh token', {
        requestBody: { required: true, content: { 'application/json': { schema: obj({ identifier: { type: 'string', description: 'email or username' }, password: str }) } } },
        responses: { 200: json(ref('Login')), ...errs(400, 401, 429) },
      }) },
      '/api/v1/auth/refresh': { post: publicOp('auth', 'Rotate the refresh token (reuse of an old one revokes the session)', {
        requestBody: { required: true, content: { 'application/json': { schema: obj({ refreshToken: str }) } } },
        responses: { 200: json(ref('Tokens')), ...errs(400, 401, 409, 429) },
      }) },
      '/api/v1/auth/logout': { post: op('auth', 'Revoke the current session (its access tokens stop working immediately)', { responses: { 204: { description: 'Logged out' }, ...errs(401, 429) } }) },
      '/api/v1/auth/password': { post: op('auth', 'Change password', {
        parameters: [idempotencyKey],
        requestBody: { required: true, content: { 'application/json': { schema: obj({ oldPassword: str, newPassword: { type: 'string', minLength: 15, maxLength: 128 } }) } } },
        responses: { 204: { description: 'Changed' }, ...errs(400, 401, 429) },
      }) },
      '/api/v1/auth/me': { get: op('auth', 'The authenticated user', { responses: { 200: json(ref('Me')), ...errs(401, 429) } }) },

      '/api/v1/auth/api-keys': {
        post: op('api-keys', 'Mint an API key (plaintext returned once)', { requestBody: { required: true, content: { 'application/json': { schema: obj({ name: str, permissions: { type: 'array', items: str }, expiresAt: dateTime }, ['name']) } } }, responses: { 201: json(anyObject, 'Created'), ...errs(400, 401, 403) } }),
        get: op('api-keys', 'List your active API keys', { responses: { 200: json(obj({ apiKeys: { type: 'array', items: anyObject } })), ...errs(401, 403) } }),
      },
      '/api/v1/auth/api-keys/{id}': { delete: op('api-keys', 'Revoke an API key', { parameters: [pathParam('id', uuid)], responses: { 204: { description: 'Revoked' }, ...errs(401, 403, 404) } }) },

      '/api/v1/admin/users': { get: op('admin', 'List users (admin)', { parameters: paging, responses: { 200: json(anyObject), ...errs(401, 403) } }) },
      '/api/v1/admin/users/{id}': { get: op('admin', 'Get a user (admin)', { parameters: [pathParam('id', uuid)], responses: { 200: json(anyObject), ...errs(401, 403, 404) } }) },
      '/api/v1/admin/users/{id}/permissions': { post: op('admin', 'Grant a permission (admin)', { parameters: [pathParam('id', uuid)], requestBody: { required: true, content: { 'application/json': { schema: obj({ permission: { type: 'string', description: '`resource:action[@scope]`' } }) } } }, responses: { 201: json(anyObject, 'Granted'), 204: { description: 'Granted' }, ...errs(400, 401, 403, 404) } }) },
      '/api/v1/admin/users/{id}/permissions/{permission}': { delete: op('admin', 'Revoke a permission (admin)', { parameters: [pathParam('id', uuid), pathParam('permission')], responses: { 204: { description: 'Revoked' }, ...errs(401, 403, 404) } }) },
      '/api/v1/admin/users/{id}/deactivate': { post: op('admin', 'Deactivate a user (admin)', { parameters: [pathParam('id', uuid)], responses: { 200: json(anyObject), 204: { description: 'Deactivated' }, ...errs(401, 403, 404) } }) },
      '/api/v1/admin/users/{id}/reactivate': { post: op('admin', 'Reactivate a user (admin)', { parameters: [pathParam('id', uuid)], responses: { 200: json(anyObject), 204: { description: 'Reactivated' }, ...errs(401, 403, 404) } }) },

      '/api/v1/workflows/templates': {
        get: op('templates', 'List published workflow templates', { responses: { 200: json(envelope(obj({ templates: { type: 'array', items: ref('Template') } }))), ...errs(401, 403) } }),
        post: op('templates', 'Publish a template version (requires template:publish). Versions are immutable: the same content again is a no-op, different content for an existing version is 409', { requestBody: { required: true, content: { 'application/json': { schema: anyObject } } }, responses: { 201: json(anyObject, 'Published'), ...errs(400, 401, 403, 409, 422) } }),
      },
      '/api/v1/workflows/templates/{key}': { get: op('templates', 'Get the current version of a template', { parameters: [pathParam('key')], responses: { 200: json(envelope(obj({ template: ref('Template') }))), ...errs(401, 403, 404) } }) },
      '/api/v1/workflows/templates/{key}/deprecate': { post: op('templates', 'Deprecate a template', { parameters: [pathParam('key')], responses: { 200: json(anyObject), ...errs(401, 403, 404, 409) } }) },
      '/api/v1/workflows': { post: op('workflows', 'Create a workflow from a template', {
        parameters: [idempotencyKey, { name: 'X-Correlation-Id', in: 'header', required: false, schema: str }],
        requestBody: { required: true, content: { 'application/json': { schema: obj({ template: str, template_version: { type: 'integer' }, context: anyObject }, ['template']) } } },
        responses: { 201: json(envelope(obj({ workflow_id: uuid, status: ref('WorkflowStatus'), template_key: str, template_version: { type: 'integer' } })), 'Created'), ...errs(400, 401, 403, 404, 409, 422, 429, 503) },
      }) },
      '/api/v1/workflows/active': { get: op('workflows', 'Workflows that are running or waiting for a human', { responses: { 200: json(envelope(obj({ workflows: { type: 'array', items: anyObject } }))), ...errs(401, 403) } }) },
      '/api/v1/workflows/{id}': { get: op('workflows', 'Get a workflow (returns a strong ETag; supports If-None-Match → 304)', {
        parameters: [pathParam('id', uuid), { name: 'If-None-Match', in: 'header', required: false, schema: str }],
        responses: { 200: { ...json(envelope(obj({ workflow: ref('Workflow') }))), headers: { ETag: { schema: str, description: '"v<version>"' } } }, 304: { description: 'Not modified' }, ...errs(401, 403, 404) },
      }) },
      '/api/v1/workflows/{id}/execute': { post: op('workflows', 'Run the workflow until it completes or needs a human (creator or workflow:execute)', {
        parameters: [pathParam('id', uuid), idempotencyKey, ifMatch],
        responses: { 200: json(envelope(obj({ workflow_id: uuid, status: ref('WorkflowStatus') }))), ...errs(401, 403, 404, 409, 412, 422, 503) },
      }) },
      '/api/v1/workflows/{id}/cancel': { post: op('workflows', 'Cancel a workflow (creator or workflow:cancel)', {
        parameters: [pathParam('id', uuid), idempotencyKey, ifMatch],
        requestBody: { required: false, content: { 'application/json': { schema: obj({ reason: str }, []) } } },
        responses: { 200: json(envelope(obj({ workflowId: uuid, status: ref('WorkflowStatus') }))), ...errs(401, 403, 404, 409, 412, 422, 503) },
      }) },
      '/api/v1/workflows/{id}/respond': { post: op('human-interaction', 'Answer the pending human step of a workflow', {
        parameters: [pathParam('id', uuid), idempotencyKey],
        requestBody: { required: true, content: { 'application/json': { schema: anyObject } } },
        responses: { 200: json(anyObject), 201: json(anyObject, 'Recorded'), ...errs(400, 401, 403, 404, 409, 422) },
      }) },
      '/api/v1/inbox': { get: op('human-interaction', 'Pending human steps the caller may answer', { responses: { 200: json(obj({ data: { type: 'array', items: ref('PendingStep') } })), ...errs(401) } }) },
      '/api/v1/inbox/{workflowId}/{stepId}': { get: op('human-interaction', 'One pending step', { parameters: [pathParam('workflowId', uuid), pathParam('stepId', uuid)], responses: { 200: json(anyObject), ...errs(401, 403, 404) } }) },

      '/api/v1/ui/generate': { post: op('ui', 'Generate a UI document for a step (AI provider; `stub` by default)', { requestBody: { required: true, content: { 'application/json': { schema: anyObject } } }, responses: { 201: json(anyObject, 'Generated'), ...errs(400, 401, 403) } }) },
      '/api/v1/ui/documents/{id}': { get: op('ui', 'Get a generated UI document', { parameters: [pathParam('id')], responses: { 200: json(anyObject), ...errs(401, 403, 404) } }) },
      '/api/v1/ui/components': { get: op('ui', 'The component catalogue a UI document may use', { responses: { 200: json(obj({ items: { type: 'array', items: obj({ name: str, version: str, kind: str }) } })), ...errs(401) } }) },

      '/api/v1/subscriptions': { get: op('notifications', 'List your notification subscriptions', { responses: { 200: json(anyObject), ...errs(401) } }) },
      '/api/v1/subscriptions/{id}': { delete: op('notifications', 'Delete a subscription', { parameters: [pathParam('id')], responses: { 204: { description: 'Deleted' }, ...errs(401, 403, 404) } }) },
      '/api/v1/webhooks': { post: op('notifications', 'Register a webhook (non-admins: `filter.workflowIds` must name workflows they created)', { requestBody: { required: true, content: { 'application/json': { schema: anyObject } } }, responses: { 201: json(anyObject, 'Created'), ...errs(400, 401, 403) } }) },
      '/api/v1/dead-letters': { get: op('notifications', 'Deliveries that exhausted their retries', { responses: { 200: json(anyObject), ...errs(401, 403) } }) },
      '/api/v1/dead-letters/{id}/retry': { post: op('notifications', 'Re-queue a dead letter', { parameters: [pathParam('id')], responses: { 200: json(anyObject), 202: json(anyObject, 'Queued'), ...errs(401, 403, 404) } }) },

      '/api/v1/analytics/workflows': { get: op('audit', 'Workflow analytics', { responses: { 200: json(anyObject), ...errs(401, 403) } }) },
      '/api/v1/analytics/users/{id}': { get: op('audit', 'Per-user analytics', { parameters: [pathParam('id')], responses: { 200: json(anyObject), ...errs(401, 403) } }) },
      '/api/v1/audit/workflows/{id}': { get: op('audit', 'Audit trail of a workflow', { parameters: [pathParam('id'), ...paging], responses: { 200: json(anyObject), ...errs(401, 403) } }) },
      '/api/v1/audit/aggregates/{type}/{id}': { get: op('audit', 'Audit trail of any aggregate', { parameters: [pathParam('type'), pathParam('id'), ...paging], responses: { 200: json(anyObject), ...errs(401, 403) } }) },
      '/api/v1/audit/integrity': { get: op('audit', 'Verify the audit hash chain (200 intact, 409 broken, 501 no chain in in-memory mode)', { responses: { 200: json(ref('AuditIntegrity')), 409: json(ref('AuditIntegrity'), 'Chain broken'), 501: json(ref('AuditIntegrity'), 'Not supported'), ...errs(401, 403) } }) },
      '/api/v1/audit/exports': { post: op('audit', 'Export audit entries', { requestBody: { required: false, content: { 'application/json': { schema: anyObject } } }, responses: { 200: json(anyObject), 202: json(anyObject, 'Accepted'), ...errs(400, 401, 403) } }) },
      '/api/v1/dashboards/active-workflows': { get: op('audit', 'Dashboard: active workflows', { responses: { 200: json(anyObject), ...errs(401, 403) } }) },
    },
  };
}
