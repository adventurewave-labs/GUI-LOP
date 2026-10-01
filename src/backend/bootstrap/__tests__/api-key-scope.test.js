/**
 * api-key-scope.test.js — API key permissions are a ceiling, end to end.
 *
 * Regression (found by the round-2 checkJs pass): keys are minted with a
 * permission list that the auth middleware put on `req.principal`, but no
 * authorisation path ever read it — a key minted as `workflow:read` could
 * create/cancel workflows, mint new keys and (for an admin owner) use admin
 * endpoints. Now: an explicit list is intersected with the owner's
 * permissions; an empty list keeps the old inherit-the-owner behaviour.
 */
import request from 'supertest';
import { bootstrap } from '../main.js';
import { AuthorisationService } from '../../contexts/identity-and-access/application/services/authorisation-service.js';
import { Permission } from '../../contexts/identity-and-access/domain/permission/permission.js';
import { RoleName } from '../../contexts/identity-and-access/domain/user/role-name.js';

const PASSWORD = 'Sup3r-Secret-Pass!';

describe('API key permission ceiling (booted app)', () => {
  let booted;
  let token;

  beforeAll(async () => {
    booted = await bootstrap({ JWT_SECRET: 'scope-secret', LOG_LEVEL: 'error', NODE_ENV: 'test' });
    await request(booted.app).post('/api/v1/auth/register')
      .send({ email: 'keys@example.com', username: 'keyowner', password: PASSWORD }).expect(201);
    const login = await request(booted.app).post('/api/v1/auth/login')
      .send({ identifier: 'keys@example.com', password: PASSWORD }).expect(200);
    token = login.body.accessToken;
  });
  afterAll(() => booted?.shutdown());

  const mint = async (permissions) => (await request(booted.app)
    .post('/api/v1/auth/api-keys')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `k-${permissions.join('+') || 'unscoped'}`, permissions })
    .expect(201)).body.plaintextKey;

  const createWorkflow = (key) => request(booted.app)
    .post('/api/v1/workflows')
    .set('Authorization', `Bearer ${key}`)
    .send({ template: 'data-analysis', context: {} });

  test('a read-only key can no longer create workflows (owner can)', async () => {
    const readOnly = await mint(['workflow:read']);
    const res = await createWorkflow(readOnly);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/not scoped for workflow:create/);
  });

  test('a key scoped to the needed permission works', async () => {
    const key = await mint(['workflow:create']);
    expect((await createWorkflow(key)).status).toBe(201);
  });

  test('an unscoped key keeps inheriting the owner (backward compatible)', async () => {
    const key = await mint([]);
    expect((await createWorkflow(key)).status).toBe(201);
  });

  test('a scoped key cannot mint itself a broader key', async () => {
    const key = await mint(['workflow:read']);
    const res = await request(booted.app)
      .post('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${key}`)
      .send({ name: 'escape', permissions: [] });
    expect(res.status).toBe(403);
  });

  test('a scoped key cannot reach admin endpoints', async () => {
    const key = await mint(['workflow:read']);
    const res = await request(booted.app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(403);
  });
});

describe('AuthorisationService ceiling semantics', () => {
  const user = (role) => ({ id: 'u1', role: new RoleName(role), isActive: true });
  const svc = (role, rolePerms) => new AuthorisationService({
    userRepository: { findById: async () => user(role) },
    roleRepository: { findByName: async () => ({ permissions: rolePerms.map((p) => new Permission(p)) }) },
  });

  test('intersection: user must hold it AND the ceiling must cover it', async () => {
    const s = svc('user', ['workflow:read', 'workflow:create']);
    expect((await s.evaluate({ userId: 'u1', permission: 'workflow:create', ceiling: ['workflow:read'] })).isFail()).toBe(true);
    expect((await s.evaluate({ userId: 'u1', permission: 'workflow:create', ceiling: ['workflow:create'] })).isOk()).toBe(true);
    // Ceiling can't grant what the user lacks.
    expect((await s.evaluate({ userId: 'u1', permission: 'template:publish', ceiling: ['template:publish'] })).isFail()).toBe(true);
  });

  test('scoped ceilings only cover their scope; admins are bounded too', async () => {
    const s = svc('user', ['workflow:respond']);
    expect((await s.evaluate({ userId: 'u1', permission: 'workflow:respond', scope: 'wf-1', ceiling: ['workflow:respond@wf-1'] })).isOk()).toBe(true);
    expect((await s.evaluate({ userId: 'u1', permission: 'workflow:respond', scope: 'wf-2', ceiling: ['workflow:respond@wf-1'] })).isFail()).toBe(true);
    const admin = svc('admin', []);
    expect((await admin.evaluate({ userId: 'u1', permission: 'workflow:cancel', ceiling: ['workflow:read'] })).isFail()).toBe(true);
    expect((await admin.evaluate({ userId: 'u1', permission: 'workflow:cancel' })).isOk()).toBe(true);
  });
});
