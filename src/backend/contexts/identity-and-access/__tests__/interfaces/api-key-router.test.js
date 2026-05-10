import express from 'express';
import request from 'supertest';
import { buildAuthRouter } from '../../interfaces/http/auth-router.js';
import { buildApiKeyRouter } from '../../interfaces/http/api-key-router.js';
import { makeAuthMiddleware } from '../../interfaces/http/auth-middleware.js';
import { RegisterUserUseCase } from '../../application/commands/register-user.js';
import { AuthenticateUserUseCase } from '../../application/commands/authenticate-user.js';
import { RefreshSessionUseCase } from '../../application/commands/refresh-session.js';
import { RevokeSessionUseCase } from '../../application/commands/revoke-session.js';
import { ChangePasswordUseCase } from '../../application/commands/change-password.js';
import { GetUserProfileQuery } from '../../application/queries/get-user-profile.js';
import { MintApiKeyUseCase } from '../../application/commands/mint-api-key.js';
import { RevokeApiKeyUseCase } from '../../application/commands/revoke-api-key.js';
import { AuthenticateWithApiKeyUseCase } from '../../application/commands/authenticate-with-api-key.js';
import { ListApiKeysForUserQuery } from '../../application/queries/list-api-keys-for-user.js';
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
    mintApiKey: new MintApiKeyUseCase(fixtures),
    revokeApiKey: new RevokeApiKeyUseCase(fixtures),
    listApiKeysForUser: new ListApiKeysForUserQuery(fixtures),
    authenticateWithApiKey: new AuthenticateWithApiKeyUseCase(fixtures),
  };

  const requireAuth = makeAuthMiddleware({
    tokenIssuer: fixtures.tokenIssuer,
    tokenBlacklist: fixtures.tokenBlacklist,
    authenticateWithApiKey: useCases.authenticateWithApiKey,
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
  app.use(
    '/api/v1/auth/api-keys',
    buildApiKeyRouter({ useCases, requireAuth }),
  );
  // A simple protected probe to test API-key auth end-to-end.
  app.get('/api/v1/echo', requireAuth, (req, res) => {
    res.json({
      principal: {
        userId: req.principal.userId,
        role: req.principal.role,
        via: req.principal.via,
        apiKeyId: req.principal.apiKeyId ?? null,
      },
    });
  });
  return { app, fixtures, useCases };
}

const creds = {
  email: 'alice@example.com',
  username: 'alice',
  password: 'super-secret-pw',
};

async function loginToken(app) {
  await request(app).post('/api/v1/auth/register').send(creds);
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: 'alice', password: creds.password });
  return login.body.accessToken;
}

describe('ApiKey HTTP router', () => {
  test('requires bearer token', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/v1/auth/api-keys').send({});
    expect(res.status).toBe(401);
  });

  test('mint returns plaintext exactly once and 201', async () => {
    const { app } = buildApp();
    const token = await loginToken(app);
    const res = await request(app)
      .post('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'CI key' });
    expect(res.status).toBe(201);
    expect(res.body.plaintextKey).toMatch(/^glop_/);
    expect(res.body.id).toBeDefined();
  });

  test('list does not expose plaintext', async () => {
    const { app } = buildApp();
    const token = await loginToken(app);
    await request(app)
      .post('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'CI key' });
    const list = await request(app)
      .get('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.apiKeys).toHaveLength(1);
    expect(list.body.apiKeys[0]).not.toHaveProperty('plaintextKey');
  });

  test('the minted key authenticates a protected route as the owner', async () => {
    const { app } = buildApp();
    const token = await loginToken(app);
    const minted = await request(app)
      .post('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'integration' });
    const echo = await request(app)
      .get('/api/v1/echo')
      .set('Authorization', `Bearer ${minted.body.plaintextKey}`);
    expect(echo.status).toBe(200);
    expect(echo.body.principal.via).toBe('api-key');
    expect(echo.body.principal.apiKeyId).toBe(minted.body.id);
  });

  test('a revoked key fails to authenticate', async () => {
    const { app } = buildApp();
    const token = await loginToken(app);
    const minted = await request(app)
      .post('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'revoke-me' });
    const del = await request(app)
      .delete(`/api/v1/auth/api-keys/${minted.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    const echo = await request(app)
      .get('/api/v1/echo')
      .set('Authorization', `Bearer ${minted.body.plaintextKey}`);
    expect(echo.status).toBe(401);
  });

  test('owner can delete; foreign user cannot', async () => {
    const { app } = buildApp();
    const tokenA = await loginToken(app);
    // Register a second user.
    await request(app).post('/api/v1/auth/register').send({
      email: 'bob@example.com',
      username: 'bob',
      password: 'super-secret-pw',
    });
    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'bob', password: 'super-secret-pw' });
    const tokenB = loginB.body.accessToken;
    // Alice mints a key.
    const minted = await request(app)
      .post('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'alice-key' });
    // Bob can't delete Alice's key.
    const forbidden = await request(app)
      .delete(`/api/v1/auth/api-keys/${minted.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(forbidden.status).toBe(403);
  });
});
