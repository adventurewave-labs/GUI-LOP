import express from 'express';
import request from 'supertest';
import { buildAuthRouter } from '../../interfaces/http/auth-router.js';
import { buildAdminRouter } from '../../interfaces/http/admin-router.js';
import { makeAuthMiddleware } from '../../interfaces/http/auth-middleware.js';
import { RegisterUserUseCase } from '../../application/commands/register-user.js';
import { AuthenticateUserUseCase } from '../../application/commands/authenticate-user.js';
import { RefreshSessionUseCase } from '../../application/commands/refresh-session.js';
import { RevokeSessionUseCase } from '../../application/commands/revoke-session.js';
import { ChangePasswordUseCase } from '../../application/commands/change-password.js';
import { GetUserProfileQuery } from '../../application/queries/get-user-profile.js';
import { GrantPermissionUseCase } from '../../application/commands/grant-permission.js';
import { RevokePermissionUseCase } from '../../application/commands/revoke-permission.js';
import { DeactivateUserUseCase } from '../../application/commands/deactivate-user.js';
import { ReactivateUserUseCase } from '../../application/commands/reactivate-user.js';
import { ListUsersQuery } from '../../application/queries/list-users.js';
import { makeFixtures, makeUuidIdGen } from '../application/test-fixtures.js';

function buildApp() {
  const fixtures = makeFixtures({ idGenerator: makeUuidIdGen() });
  const useCases = {
    registerUser: new RegisterUserUseCase(fixtures),
    authenticateUser: new AuthenticateUserUseCase(fixtures),
    refreshSession: new RefreshSessionUseCase(fixtures),
    revokeSession: new RevokeSessionUseCase(fixtures),
    changePassword: new ChangePasswordUseCase(fixtures),
    getUserProfile: new GetUserProfileQuery(fixtures),
    grantPermission: new GrantPermissionUseCase(fixtures),
    revokePermission: new RevokePermissionUseCase(fixtures),
    deactivateUser: new DeactivateUserUseCase(fixtures),
    reactivateUser: new ReactivateUserUseCase(fixtures),
    listUsers: new ListUsersQuery(fixtures),
  };

  const requireAuth = makeAuthMiddleware({
    tokenIssuer: fixtures.tokenIssuer,
    tokenBlacklist: fixtures.tokenBlacklist,
  });

  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/auth',
    buildAuthRouter({
      useCases,
      tokenIssuer: fixtures.tokenIssuer,
      tokenBlacklist: fixtures.tokenBlacklist,
      loginRateLimit: (_req, _res, next) => next(),
      refreshRateLimit: (_req, _res, next) => next(),
    }),
  );
  app.use('/api/v1/admin', buildAdminRouter({ useCases, requireAuth }));
  return { app, fixtures, useCases };
}

async function registerAndLogin(app, { username, role }) {
  await request(app).post('/api/v1/auth/register').send({
    email: `${username}@example.com`,
    username,
    password: 'super-secret-pw',
    role,
  });
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: username, password: 'super-secret-pw' });
  return { token: res.body.accessToken, userId: res.body.user.id };
}

describe('Admin HTTP router', () => {
  test('401 without token on every endpoint', async () => {
    const { app } = buildApp();
    for (const r of [
      ['get', '/api/v1/admin/users'],
      ['get', '/api/v1/admin/users/u-1'],
      ['post', '/api/v1/admin/users/u-1/permissions'],
      ['delete', '/api/v1/admin/users/u-1/permissions/workflow:read'],
      ['post', '/api/v1/admin/users/u-1/deactivate'],
      ['post', '/api/v1/admin/users/u-1/reactivate'],
    ]) {
      const [method, url] = r;
      const res = await request(app)[method](url);
      expect(res.status).toBe(401);
    }
  });

  test('403 with non-admin token (envelope)', async () => {
    const { app } = buildApp();
    const { token } = await registerAndLogin(app, { username: 'bob', role: 'user' });
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      code: 'forbidden',
      message: 'admin only',
    });
  });

  test('200 with admin token: list users (paginated)', async () => {
    const { app } = buildApp();
    const { token } = await registerAndLogin(app, { username: 'root', role: 'admin' });
    await registerAndLogin(app, { username: 'carol', role: 'user' });
    const res = await request(app)
      .get('/api/v1/admin/users?limit=10&offset=0')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination.limit).toBe(10);
  });

  test('admin can fetch single user profile', async () => {
    const { app } = buildApp();
    const { token } = await registerAndLogin(app, { username: 'root', role: 'admin' });
    const { userId: carolId } = await registerAndLogin(app, {
      username: 'carol',
      role: 'user',
    });
    const res = await request(app)
      .get(`/api/v1/admin/users/${carolId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('carol');
  });

  test('admin can grant a permission and emits permission.granted', async () => {
    const { app, fixtures } = buildApp();
    const { token } = await registerAndLogin(app, { username: 'root', role: 'admin' });
    const { userId } = await registerAndLogin(app, {
      username: 'carol',
      role: 'user',
    });
    const res = await request(app)
      .post(`/api/v1/admin/users/${userId}/permissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permission: 'workflow:read', scope: 'wf-7' });
    expect(res.status).toBe(201);
    expect(res.body.permission).toBe('workflow:read@wf-7');
    expect(fixtures.outbox.events.map((e) => e.eventType)).toContain(
      'permission.granted',
    );
  });

  test('granting the same permission twice is idempotent (still 201, single grant stored)', async () => {
    const { app, fixtures } = buildApp();
    const { token } = await registerAndLogin(app, { username: 'root', role: 'admin' });
    const { userId } = await registerAndLogin(app, {
      username: 'carol',
      role: 'user',
    });
    const r1 = await request(app)
      .post(`/api/v1/admin/users/${userId}/permissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permission: 'workflow:read' });
    expect(r1.status).toBe(201);
    const r2 = await request(app)
      .post(`/api/v1/admin/users/${userId}/permissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permission: 'workflow:read' });
    expect(r2.status).toBe(201);
    const grants = await fixtures.grantsRepository.list(userId);
    expect(grants).toHaveLength(1);
  });

  test('admin can revoke a permission', async () => {
    const { app, fixtures } = buildApp();
    const { token } = await registerAndLogin(app, { username: 'root', role: 'admin' });
    const { userId } = await registerAndLogin(app, {
      username: 'carol',
      role: 'user',
    });
    await request(app)
      .post(`/api/v1/admin/users/${userId}/permissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permission: 'workflow:read', scope: 'wf-1' });
    const res = await request(app)
      .delete(
        `/api/v1/admin/users/${userId}/permissions/workflow:read?scope=wf-1`,
      )
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.permission).toBe('workflow:read@wf-1');
    const grants = await fixtures.grantsRepository.list(userId);
    expect(grants).toHaveLength(0);
    expect(fixtures.outbox.events.map((e) => e.eventType)).toContain(
      'permission.revoked',
    );
  });

  test('admin can deactivate then reactivate a user', async () => {
    const { app } = buildApp();
    const { token } = await registerAndLogin(app, { username: 'root', role: 'admin' });
    const { userId } = await registerAndLogin(app, {
      username: 'carol',
      role: 'user',
    });
    const off = await request(app)
      .post(`/api/v1/admin/users/${userId}/deactivate`)
      .set('Authorization', `Bearer ${token}`);
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    const on = await request(app)
      .post(`/api/v1/admin/users/${userId}/reactivate`)
      .set('Authorization', `Bearer ${token}`);
    expect(on.status).toBe(200);
    expect(on.body.isActive).toBe(true);
  });

  test('deactivating a missing user returns 404', async () => {
    const { app } = buildApp();
    const { token } = await registerAndLogin(app, { username: 'root', role: 'admin' });
    const res = await request(app)
      .post('/api/v1/admin/users/does-not-exist/deactivate')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
