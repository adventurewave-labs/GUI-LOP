/**
 * Authorisation on the audit, analytics and notification routes.
 *
 * These routers were mounted behind authentication only: any signed-in user
 * (a `viewer`, or an API key scoped to one permission) could read the whole
 * audit trail, export compliance data, read/replay dead letters, list and
 * delete other users' subscriptions, and register webhooks to internal
 * addresses (SSRF).
 */
import request from 'supertest';
import { bootstrap } from '../main.js';
import { webhookUrlProblem } from '../../contexts/notification/interfaces/http/webhook-url.js';

describe('webhookUrlProblem (SSRF guard)', () => {
  test.each([
    'https://hooks.example.com/gui-lop',
    'https://example.org:8443/path?x=1',
    'https://203.0.113.10/hook',
    'https://[2001:db8::1]/hook',
  ])('accepts %s', (u) => expect(webhookUrlProblem(u)).toBeNull());

  test.each([
    ['http://hooks.example.com/x', /https/],
    ['ftp://example.com/x', /https/],
    ['javascript:alert(1)', /https/],
    ['https://user:pass@example.com/x', /credentials/],
    ['https://localhost/x', /public host/],
    ['https://127.0.0.1/x', /private or loopback/],
    ['https://2130706433/x', /private or loopback/],       // decimal 127.0.0.1
    ['https://0x7f.0.0.1/x', /private or loopback/],
    ['https://169.254.169.254/latest/meta-data/', /private or loopback/],
    ['https://10.0.0.5/x', /private or loopback/],
    ['https://172.16.3.4/x', /private or loopback/],
    ['https://192.168.1.1/x', /private or loopback/],
    ['https://100.64.0.1/x', /private or loopback/],
    ['https://0.0.0.0/x', /private or loopback/],
    ['https://[::1]/x', /private or loopback/],
    ['https://[fd00::1]/x', /private or loopback/],
    ['https://[fe80::1]/x', /private or loopback/],
    ['https://[::ffff:10.0.0.1]/x', /private or loopback/],
    ['https://postgres/x', /public host/],
    ['https://redis.railway.internal/x', /public host/],
    ['https://printer.local/x', /public host/],
    ['not a url', /valid URL/],
    ['', /string/],
    [42, /string/],
    [`https://example.com/${'a'.repeat(2100)}`, /2048/],
  ])('refuses %p', (u, why) => expect(webhookUrlProblem(u)).toMatch(why));

  test('allowInsecure (non-production) permits http and private targets, never credentials or other schemes', () => {
    expect(webhookUrlProblem('http://localhost:9000/hook', { allowInsecure: true })).toBeNull();
    expect(webhookUrlProblem('https://u:p@localhost/hook', { allowInsecure: true })).toMatch(/credentials/);
    expect(webhookUrlProblem('file:///etc/passwd', { allowInsecure: true })).toMatch(/https/);
  });
});

describe('route authorisation (booted app)', () => {
  let booted; let api;
  const tokens = {};

  beforeAll(async () => {
    booted = await bootstrap({ JWT_SECRET: 'authz-secret', LOG_LEVEL: 'error', NODE_ENV: 'test' });
    api = request(booted.app);
    const mk = async (name, role) => {
      const u = await booted.ctx.identity.useCases.registerUser.execute({ email: `${name}@example.com`, username: `authz_${name}`, password: `authz passphrase ${name}`, role });
      const { token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: u.id, role, sid: `s-${name}` }, 900);
      tokens[name] = { id: u.id, auth: { Authorization: `Bearer ${token}` } };
    };
    await mk('admin', 'admin'); await mk('alice', 'user'); await mk('bob', 'user'); await mk('vera', 'viewer');
  });
  afterAll(() => booted?.shutdown());

  const WF = '3f2b8c1e-9d4a-4e7b-8c2d-1a2b3c4d5e6f';

  test.each([
    ['get', `/api/v1/audit/workflows/${WF}`],
    ['get', `/api/v1/audit/aggregates/workflow/${WF}`],
    ['post', '/api/v1/audit/exports'],
    ['get', '/api/v1/dead-letters'],
    ['post', '/api/v1/dead-letters/abc/retry'],
  ])('%s %s: user and viewer → 403, anonymous → 401, admin allowed', async (method, path) => {
    expect((await api[method](path).set(tokens.alice.auth).send({})).status).toBe(403);
    expect((await api[method](path).set(tokens.vera.auth).send({})).status).toBe(403);
    expect((await api[method](path).send({})).status).toBe(401);
    expect([200, 201, 400, 404]).toContain((await api[method](path).set(tokens.admin.auth).send({})).status);
  });

  test('a user granted audit:read can read the trail (but still cannot export)', async () => {
    await api.post(`/api/v1/admin/users/${tokens.bob.id}/permissions`).set(tokens.admin.auth).send({ permission: 'audit:read' });
    expect((await api.get(`/api/v1/audit/workflows/${WF}`).set(tokens.bob.auth)).status).toBe(200);
    expect((await api.post('/api/v1/audit/exports').set(tokens.bob.auth).send({})).status).toBe(403);
  });

  test('audit integrity: audit:read only; in-memory mode has no chain and says so (501, never "intact")', async () => {
    expect((await api.get('/api/v1/audit/integrity')).status).toBe(401);
    expect((await api.get('/api/v1/audit/integrity').set(tokens.alice.auth)).status).toBe(403);
    const res = await api.get('/api/v1/audit/integrity').set(tokens.admin.auth);
    expect(res.status).toBe(501);
    expect(res.body).toMatchObject({ supported: false, ok: false, head: null });
  });

  test('analytics: workflow readers may see workflow analytics and the dashboard; per-user activity is self or audit:read', async () => {
    expect((await api.get('/api/v1/analytics/workflows').set(tokens.vera.auth)).status).toBe(200);
    expect((await api.get('/api/v1/dashboards/active-workflows').set(tokens.alice.auth)).status).toBe(200);
    expect((await api.get(`/api/v1/analytics/users/${tokens.alice.id}`).set(tokens.alice.auth)).status).toBe(200);
    expect((await api.get(`/api/v1/analytics/users/${tokens.alice.id}`).set(tokens.vera.auth)).status).toBe(403);
    expect((await api.get(`/api/v1/analytics/users/${tokens.alice.id}`).set(tokens.admin.auth)).status).toBe(200);
  });

  test('an API key scoped to workflow:read cannot read the audit trail even when its owner is an admin', async () => {
    const minted = await api.post('/api/v1/auth/api-keys').set(tokens.admin.auth).send({ name: 'reader', permissions: ['workflow:read'] });
    expect(minted.status).toBe(201);
    const key = minted.body.plaintextKey;
    expect(typeof key).toBe('string');
    const auth = { Authorization: `Bearer ${key}` };
    expect((await api.get('/api/v1/analytics/workflows').set(auth)).status).toBe(200);
    expect((await api.get(`/api/v1/audit/workflows/${WF}`).set(auth)).status).toBe(403);
    expect((await api.get('/api/v1/dead-letters').set(auth)).status).toBe(403);
  });

  test('subscriptions are owner-scoped: no listing, deleting or registering for someone else', async () => {
    const wf = await api.post('/api/v1/workflows').set(tokens.alice.auth).set('Idempotency-Key', 'authz-sub-wf')
      .send({ template: 'data-analysis', context: {} }).expect(201);
    const created = await api.post('/api/v1/webhooks').set(tokens.alice.auth)
      .send({ url: 'http://localhost:9/hook', subscriberRef: tokens.bob.id, filter: { workflowIds: [wf.body.data.workflow_id] } });
    expect(created.status).toBe(201);

    const alices = (await api.get('/api/v1/subscriptions').set(tokens.alice.auth).expect(200)).body.items;
    expect(alices).toHaveLength(1); // registered under alice, not under the subscriberRef she asked for
    const id = alices[0].id;

    // bob cannot see it by asking for alice's ref, nor delete it
    expect((await api.get(`/api/v1/subscriptions?ref=${tokens.alice.id}`).set(tokens.bob.auth).expect(200)).body.items).toHaveLength(0);
    expect((await api.delete(`/api/v1/subscriptions/${id}`).set(tokens.bob.auth)).status).toBe(404);
    expect((await api.get('/api/v1/subscriptions').set(tokens.alice.auth)).body.items).toHaveLength(1);

    // an admin can act for another subject; the owner can delete her own
    expect((await api.get(`/api/v1/subscriptions?ref=${tokens.alice.id}`).set(tokens.admin.auth)).body.items).toHaveLength(1);
    expect((await api.delete(`/api/v1/subscriptions/${id}`).set(tokens.alice.auth)).status).toBe(204);
  });

  test('sign-up cannot choose a role (was: {"role":"admin"} made anyone an administrator)', async () => {
    for (const role of ['admin', 'viewer']) {
      const res = await api.post('/api/v1/auth/register')
        .send({ email: `esc-${role}@example.com`, username: `esc_${role}`, password: 'privilege escalation test', role, isActive: false, permissions: ['*:*'] });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe('user');
      const login = await api.post('/api/v1/auth/login').send({ identifier: `esc_${role}`, password: 'privilege escalation test' }).expect(200);
      const auth = { Authorization: `Bearer ${login.body.accessToken}` };
      expect(login.body.user.role).toBe('user');
      expect((await api.get('/api/v1/admin/users').set(auth)).status).toBe(403);
      expect((await api.get('/api/v1/dead-letters').set(auth)).status).toBe(403);
    }
  });

  test('webhook URLs with credentials or non-http schemes are refused even outside production', async () => {
    const res = await api.post('/api/v1/webhooks').set(tokens.admin.auth).send({ url: 'https://u:p@example.com/x' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/INVALID_WEBHOOK_URL/);
    expect((await api.post('/api/v1/webhooks').set(tokens.admin.auth).send({ url: 'file:///etc/passwd' })).status).toBe(400);
  });
});
