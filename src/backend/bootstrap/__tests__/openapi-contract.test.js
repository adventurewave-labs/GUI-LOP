/**
 * OpenAPI contract (roadmap 22 / P8). The spec cannot drift:
 *   1. the set of documented operations must equal the routes Express serves;
 *   2. real responses from the booted app must validate against the schemas
 *      (JSON Schema 2020-12 via Ajv);
 *   3. the document itself is structurally sound (refs resolve, every
 *      operation has a tag, summary, security and responses).
 */
import Ajv2020 from 'ajv/dist/2020.js';
import request from 'supertest';
import { bootstrap } from '../main.js';
import { buildOpenApiDocument } from '../openapi.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Walk the Express router tree → ["GET /api/v1/x/{id}", …]. */
function servedRoutes(app) {
  const out = new Set();
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) {
          const p = `${prefix}${layer.route.path}`.replace(/\/$/, '') || '/';
          out.add(`${m.toUpperCase()} ${p.replace(/:([A-Za-z_]+)/g, '{$1}')}`);
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        const mount = layer.regexp.source
          .replace('^\\/', '/').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/').replace(/[\^$]/g, '');
        walk(layer.handle.stack, prefix + (mount === '/' ? '' : mount));
      }
    }
  };
  walk(app._router.stack, '');
  return [...out].sort();
}

const documented = (doc) => Object.entries(doc.paths)
  .flatMap(([p, item]) => METHODS.filter((m) => item[m]).map((m) => `${m.toUpperCase()} ${p}`))
  .sort();

describe('OpenAPI document', () => {
  const doc = buildOpenApiDocument({ version: 'abc1234' });

  test('is OpenAPI 3.1 with the deployed version', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('abc1234');
    expect(buildOpenApiDocument().info.version).toBe('1.0.0');
  });

  test('every operation has a known tag, a summary, explicit security and at least one response', () => {
    const tags = new Set(doc.tags.map((t) => t.name));
    for (const [p, item] of Object.entries(doc.paths)) {
      for (const m of METHODS.filter((x) => item[x])) {
        const o = item[m];
        expect({ where: `${m} ${p}`, tag: tags.has(o.tags?.[0]), summary: typeof o.summary === 'string' && o.summary.length > 5, security: Array.isArray(o.security), responses: Object.keys(o.responses ?? {}).length > 0 })
          .toEqual({ where: `${m} ${p}`, tag: true, summary: true, security: true, responses: true });
      }
    }
  });

  test('every $ref resolves and every path parameter is declared', () => {
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) expect(Object.keys(doc.components.schemas)).toContain(r);
    for (const [p, item] of Object.entries(doc.paths)) {
      const inPath = [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
      for (const m of METHODS.filter((x) => item[x])) {
        const declared = (item[m].parameters ?? []).filter((x) => x.in === 'path').map((x) => x.name).sort();
        expect({ where: `${m} ${p}`, declared }).toEqual({ where: `${m} ${p}`, declared: inPath });
      }
    }
  });

  test('all schemas compile as JSON Schema 2020-12', () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const [name, schema] of Object.entries(doc.components.schemas)) {
      expect(() => ajv.compile({ $id: `urn:schema:${name}`, components: doc.components, ...schema })).not.toThrow();
    }
  });
});

describe('OpenAPI ↔ running app', () => {
  let booted; let api; let doc; let validate;

  beforeAll(async () => {
    booted = await bootstrap({ JWT_SECRET: 'openapi-secret', LOG_LEVEL: 'error', NODE_ENV: 'test', GIT_SHA: 'abc1234' });
    api = request(booted.app);
    doc = (await api.get('/api/v1/openapi.json').expect(200)).body;
    const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
    let n = 0;
    validate = (method, path, res) => {
      const response = doc.paths[path]?.[method]?.responses?.[String(res.status)];
      if (!response) return [`${method.toUpperCase()} ${path}: status ${res.status} is not documented`];
      const media = response.content?.['application/json'] ?? response.content?.['application/problem+json'];
      if (!media) return res.text ? [`${method.toUpperCase()} ${path} ${res.status}: body returned but none documented`] : [];
      const check = ajv.compile({ $id: `urn:resp:${n++}`, components: doc.components, ...media.schema });
      return check(res.body) ? [] : check.errors.map((e) => `${method.toUpperCase()} ${path} ${res.status}: ${e.instancePath} ${e.message}`);
    };
  });
  afterAll(() => booted?.shutdown());

  test('the document is served publicly and is cacheable', async () => {
    const res = await api.get('/api/v1/openapi.json').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.body.info.version).toBe('abc1234');
  });

  test('documented operations == served routes (no undocumented route, no phantom operation)', () => {
    expect(documented(doc)).toEqual(servedRoutes(booted.app));
  });

  test('UI routes are served where they are documented (were /api/v1/ui/ui/*)', async () => {
    const reg = await booted.ctx.identity.useCases.registerUser.execute({ email: 'ui@example.com', username: 'ui_user', password: 'ui route passphrase 1' });
    const { token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: reg.id, role: 'user', sid: 's-ui' }, 900);
    const res = await api.get('/api/v1/ui/components').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(validate('get', '/api/v1/ui/components', res)).toEqual([]);
    await api.get('/api/v1/ui/ui/components').set('Authorization', `Bearer ${token}`).expect(404);
  });

  test('the validator actually rejects (guards against a vacuous pass)', () => {
    expect(validate('get', '/livez', { status: 200, body: { status: 'nope' }, text: '{}' })).not.toEqual([]);
    expect(validate('get', '/livez', { status: 418, body: {}, text: '{}' })).toEqual(['GET /livez: status 418 is not documented']);
    expect(validate('post', '/api/v1/auth/login', { status: 200, body: { accessToken: 'x' }, text: '{}' }).length).toBeGreaterThan(0);
  });

  test('real responses of the core journey match their schemas', async () => {
    const problems = [];
    const check = (method, path, res) => problems.push(...validate(method, path, res));
    const user = { email: 'contract@example.com', username: 'contract_user', password: 'contract test passphrase' };

    check('get', '/livez', await api.get('/livez'));
    check('get', '/readyz', await api.get('/readyz'));
    check('post', '/api/v1/auth/register', await api.post('/api/v1/auth/register').send(user));
    check('post', '/api/v1/auth/register', await api.post('/api/v1/auth/register').send({ ...user, username: 'other_user_1', email: 'o@example.com', password: 'short' }));
    check('post', '/api/v1/auth/register', await api.post('/api/v1/auth/register').send(user)); // duplicate → 409
    const login = await api.post('/api/v1/auth/login').send({ identifier: user.username, password: user.password });
    check('post', '/api/v1/auth/login', login);
    check('post', '/api/v1/auth/login', await api.post('/api/v1/auth/login').send({ identifier: user.username, password: 'wrong password entirely' }));
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    check('get', '/api/v1/auth/me', await api.get('/api/v1/auth/me').set(auth));
    check('get', '/api/v1/auth/me', await api.get('/api/v1/auth/me'));
    check('post', '/api/v1/auth/refresh', await api.post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }));
    check('get', '/api/v1/auth/api-keys', await api.get('/api/v1/auth/api-keys').set(auth));
    check('get', '/api/v1/workflows/templates', await api.get('/api/v1/workflows/templates').set(auth));
    check('get', '/api/v1/workflows/templates/{key}', await api.get('/api/v1/workflows/templates/data-analysis').set(auth));
    check('get', '/api/v1/workflows/templates/{key}', await api.get('/api/v1/workflows/templates/no-such-template').set(auth));
    const created = await api.post('/api/v1/workflows').set(auth).send({ template: 'data-analysis', context: {} });
    check('post', '/api/v1/workflows', created);
    check('post', '/api/v1/workflows', await api.post('/api/v1/workflows').set(auth).send({ template: 'no-such-template' }));
    const id = created.body.data.workflow_id;
    const got = await api.get(`/api/v1/workflows/${id}`).set(auth);
    check('get', '/api/v1/workflows/{id}', got);
    check('get', '/api/v1/workflows/{id}', await api.get('/api/v1/workflows/3f2b8c1e-9d4a-4e7b-8c2d-1a2b3c4d5e6f').set(auth));
    check('post', '/api/v1/workflows/{id}/execute', await api.post(`/api/v1/workflows/${id}/execute`).set(auth).send({}));
    check('post', '/api/v1/workflows/{id}/execute', await api.post(`/api/v1/workflows/${id}/execute`).set(auth).set('If-Match', got.headers.etag).send({})); // stale → 412
    check('get', '/api/v1/workflows/active', await api.get('/api/v1/workflows/active').set(auth));
    check('get', '/api/v1/inbox', await api.get('/api/v1/inbox').set(auth));
    check('post', '/api/v1/workflows/{id}/cancel', await api.post(`/api/v1/workflows/${id}/cancel`).set(auth).send({ reason: 'contract test' }));
    check('get', '/api/v1/admin/users', await api.get('/api/v1/admin/users').set(auth)); // non-admin → 403

    expect(problems).toEqual([]);
  });
});
