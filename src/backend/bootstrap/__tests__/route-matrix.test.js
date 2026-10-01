/**
 * Authorisation sweep (roadmap P10b).
 *
 * P10 found unguarded routes by accident; this suite makes the check
 * systematic. Part 1 walks EVERY documented operation (the OpenAPI document
 * is proven equal to the served route table in openapi-contract.test.js) and
 * requires 401 without credentials unless the operation is on the explicit
 * public list. Part 2 pins the cross-user and read-only-role rules that the
 * sweep found broken:
 *   - the inbox listed (and opened) other people's pending steps for a
 *     `viewer` who cannot respond at all;
 *   - a `viewer` could call the AI-backed UI generator;
 *   - any user could register an unfiltered webhook and receive every
 *     user's events.
 */
import request from 'supertest';
import { bootstrap } from '../main.js';
import { buildOpenApiDocument } from '../openapi.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const PUBLIC = [
  'GET /livez', 'GET /readyz', 'GET /health',
  'GET /api/v1/openapi.json',
  'POST /api/v1/auth/register', 'POST /api/v1/auth/login', 'POST /api/v1/auth/refresh',
];

describe('route matrix (booted app)', () => {
  let booted; let api;
  const who = {};
  const doc = buildOpenApiDocument();
  const operations = Object.entries(doc.paths).flatMap(([path, item]) => METHODS.filter((m) => item[m]).map((m) => ({ method: m, path, op: item[m] })));

  beforeAll(async () => {
    booted = await bootstrap({ JWT_SECRET: 'matrix-secret', LOG_LEVEL: 'error', NODE_ENV: 'test', RATE_LIMIT_MAX: '100000' });
    api = request(booted.app);
    const mk = async (name, role) => {
      const u = await booted.ctx.identity.useCases.registerUser.execute({ email: `${name}@matrix.example`, username: `mx_${name}`, password: `matrix passphrase ${name}`, role });
      const { token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: u.id, role, sid: `mx-${name}` }, 900);
      who[name] = { id: u.id, auth: { Authorization: `Bearer ${token}` } };
    };
    await mk('admin', 'admin'); await mk('alice', 'user'); await mk('bob', 'user'); await mk('vera', 'viewer');
  });
  afterAll(() => booted?.shutdown());

  const fill = (path) => path.replace(/\{[^}]+\}/g, '3f2b8c1e-9d4a-4e7b-8c2d-1a2b3c4d5e6f');

  test('the public list is exactly the operations documented without security', () => {
    const open = operations.filter((o) => o.op.security.length === 0).map((o) => `${o.method.toUpperCase()} ${o.path}`).sort();
    // Anything new here is a deliberate decision, made in this file.
    expect(open).toEqual([...PUBLIC].sort());
  });

  test('every other operation answers 401 without credentials and with a garbage token', async () => {
    const leaks = [];
    for (const o of operations.filter((x) => x.op.security.length > 0 && x.path.startsWith('/api/v1'))) {
      const url = fill(o.path);
      const anon = await api[o.method](url).set('Idempotency-Key', 'k').send({});
      const junk = await api[o.method](url).set('Authorization', 'Bearer not.a.token').set('Idempotency-Key', 'k').send({});
      if (anon.status !== 401 || junk.status !== 401) leaks.push(`${o.method.toUpperCase()} ${o.path} → ${anon.status}/${junk.status}`);
    }
    expect(leaks).toEqual([]);
  });

  test('a read-only viewer gets no 2xx from any mutating operation', async () => {
    const allowed = new Set(['POST /api/v1/auth/logout', 'POST /api/v1/auth/logout-all', 'POST /api/v1/auth/change-password', 'POST /api/v1/auth/api-keys', 'DELETE /api/v1/auth/api-keys/{id}', 'DELETE /api/v1/subscriptions/{id}']);
    const wrote = [];
    for (const o of operations.filter((x) => x.method !== 'get' && x.op.security.length > 0 && x.path.startsWith('/api/v1'))) {
      const name = `${o.method.toUpperCase()} ${o.path}`;
      if (allowed.has(name) || o.path.startsWith('/api/v1/auth/')) continue; // own account, own keys
      const res = await api[o.method](fill(o.path)).set(who.vera.auth).set('Idempotency-Key', `v-${name}`)
        .send({ template: 'data-analysis', context: {}, url: 'http://localhost:9/h', filter: {}, workflowId: 'w', stepId: 's', action: 'approve' });
      if (res.status < 400) wrote.push(`${name} → ${res.status}`);
    }
    expect(wrote).toEqual([]);
  });

  describe('pending steps, UI generation and webhooks', () => {
    let wf; const STEP = 'review';

    beforeAll(async () => {
      const res = await api.post('/api/v1/workflows').set(who.alice.auth).set('Idempotency-Key', 'mx-wf').send({ template: 'data-analysis', context: {} }).expect(201);
      wf = res.body.data.workflow_id;
      await booted.ctx.humanInteraction.eventHandlers.onWorkflowHumanInputRequired.handle({ payload: { workflowId: wf, stepId: STEP, eligibility: {} } });
      await booted.ctx.humanInteraction.eventHandlers.onWorkflowHumanInputRequired.handle({ payload: { workflowId: wf, stepId: 'admins-only', eligibility: { requiredRole: 'admin' } } });
    });

    const inbox = async (auth) => (await api.get('/api/v1/inbox').set(auth).expect(200)).body.data.map((s) => s.stepId ?? s.step_id);

    test('inbox lists only steps the caller can answer', async () => {
      expect(await inbox(who.alice.auth)).toEqual([STEP]);
      expect(await inbox(who.bob.auth)).toEqual([STEP]);            // open step: any responder
      expect((await inbox(who.admin.auth)).sort()).toEqual(['admins-only', STEP]);
      expect(await inbox(who.vera.auth)).toEqual([]);                // was: [STEP]
    });

    test('a step opens for a responder or the workflow owner, and is 404 for everyone else', async () => {
      const get = (auth, step) => api.get(`/api/v1/inbox/${wf}/${step}`).set(auth);
      expect((await get(who.bob.auth, STEP)).status).toBe(200);
      expect((await get(who.vera.auth, STEP)).status).toBe(404);     // was: 200
      expect((await get(who.alice.auth, 'admins-only')).status).toBe(200); // owner may look
      expect((await get(who.bob.auth, 'admins-only')).status).toBe(404);
      expect((await get(who.admin.auth, 'admins-only')).status).toBe(200);
      expect((await get(who.alice.auth, 'no-such-step')).status).toBe(404);
    });

    test('an API key without workflow:respond sees an empty inbox even when its owner is an admin', async () => {
      const minted = await api.post('/api/v1/auth/api-keys').set(who.admin.auth).send({ name: 'ro', permissions: ['workflow:read'] }).expect(201);
      const auth = { Authorization: `Bearer ${minted.body.plaintextKey}` };
      expect(await inbox(auth)).toEqual([]);
      expect((await api.get(`/api/v1/inbox/${wf}/${STEP}`).set(auth)).status).toBe(404);
    });

    test('an API key cannot exceed its owner: a viewer key "with workflow:create" creates nothing', async () => {
      const minted = await api.post('/api/v1/auth/api-keys').set(who.vera.auth).send({ name: 'wish', permissions: ['workflow:create'] });
      if (minted.status !== 201) return; // refusing to mint is also fine
      const res = await api.post('/api/v1/workflows').set({ Authorization: `Bearer ${minted.body.plaintextKey}` }).set('Idempotency-Key', 'mx-vk').send({ template: 'data-analysis', context: {} });
      expect(res.status).toBe(403);
    });

    test('UI generation needs workflow:create; reading the catalogue needs workflow:read', async () => {
      const body = { workflowId: wf, stepId: STEP, stepName: 'Review', stepDescription: 'Review the data' };
      expect((await api.post('/api/v1/ui/generate').set(who.vera.auth).send(body)).status).toBe(403); // was: 201
      expect((await api.post('/api/v1/ui/generate').set(who.alice.auth).send(body)).status).not.toBe(403);
      expect((await api.get('/api/v1/ui/components').set(who.vera.auth)).status).toBe(200);
      const key = await api.post('/api/v1/auth/api-keys').set(who.alice.auth).send({ name: 'resp', permissions: ['workflow:respond'] }).expect(201);
      const auth = { Authorization: `Bearer ${key.body.plaintextKey}` };
      expect((await api.get('/api/v1/ui/components').set(auth)).status).toBe(403);
      expect((await api.post('/api/v1/ui/generate').set(auth).send(body)).status).toBe(403);
    });

    test('webhooks: non-admins subscribe only to workflows they created; unfiltered needs notification:admin', async () => {
      const post = (auth, filter) => api.post('/api/v1/webhooks').set(auth).send({ url: 'http://localhost:9/hook', filter });
      for (const filter of [undefined, {}, { workflowIds: [] }, { eventTypes: ['workflow.completed'] }, { workflowIds: 'all' }, { workflowIds: [42] }]) {
        const res = await post(who.alice.auth, filter);                // was: 201 for all of these
        expect({ filter, status: res.status, code: res.body.code }).toEqual({ filter, status: 403, code: 'WEBHOOK_SCOPE_REQUIRED' });
      }
      expect((await post(who.bob.auth, { workflowIds: [wf] })).status).toBe(403);                      // alice's workflow
      expect((await post(who.alice.auth, { workflowIds: [wf, '3f2b8c1e-9d4a-4e7b-8c2d-1a2b3c4d5e6f'] })).status).toBe(403); // one unknown
      expect((await post(who.alice.auth, { workflowIds: Array.from({ length: 51 }, () => wf) })).status).toBe(403);
      expect((await post(who.alice.auth, { workflowIds: [wf], eventTypes: ['workflow.completed'] })).status).toBe(201);
      expect((await post(who.admin.auth, {})).status).toBe(201);

      await api.post(`/api/v1/admin/users/${who.bob.id}/permissions`).set(who.admin.auth).send({ permission: 'notification:admin' }).expect((r) => { if (r.status >= 300) throw new Error(`grant ${r.status}`); });
      expect((await post(who.bob.auth, {})).status).toBe(201);

      const key = await api.post('/api/v1/auth/api-keys').set(who.admin.auth).send({ name: 'wf-only', permissions: ['workflow:create'] }).expect(201);
      expect((await post({ Authorization: `Bearer ${key.body.plaintextKey}` }, {})).status).toBe(403); // ceiling bounds an admin
    });
  });
});
