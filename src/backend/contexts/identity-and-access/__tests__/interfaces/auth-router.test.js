import request from 'supertest';
import { buildTestApp } from './test-app.js';

const creds = {
  email: 'alice@example.com',
  username: 'alice',
  password: 'super-secret-pw',
};

describe('Auth HTTP router', () => {
  test('POST /register creates user (201)', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/v1/auth/register').send(creds);
    expect(res.status).toBe(201);
    expect(res.body.username).toBe('alice');
  });

  test('POST /register conflicts on duplicate email (409)', async () => {
    const { app } = buildTestApp();
    await request(app).post('/api/v1/auth/register').send(creds);
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...creds, username: 'bob' });
    expect(res.status).toBe(409);
  });

  test('POST /register validation error (400)', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'bad', username: 'alice', password: 'longenuf1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  test('POST /login returns access + refresh; bad password is 401', async () => {
    const { app } = buildTestApp();
    await request(app).post('/api/v1/auth/register').send(creds);
    const ok = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'alice', password: creds.password });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toEqual(expect.any(String));
    expect(ok.body.refreshToken).toMatch(/^[a-f0-9]{64}$/);

    const bad = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'alice', password: 'wrong' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('invalid_credentials');
  });

  test('POST /refresh rotates the refresh token', async () => {
    const { app } = buildTestApp();
    await request(app).post('/api/v1/auth/register').send(creds);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'alice', password: creds.password });
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(login.body.refreshToken);
  });

  test('GET /me requires bearer token', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  test('GET /me returns profile with valid token', async () => {
    const { app } = buildTestApp();
    await request(app).post('/api/v1/auth/register').send(creds);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'alice', password: creds.password });
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('alice');
  });

  test('POST /logout revokes session and blacklists token', async () => {
    const { app, fixtures } = buildTestApp();
    await request(app).post('/api/v1/auth/register').send(creds);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'alice', password: creds.password });
    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(out.status).toBe(204);
    // Subsequent /me with same token denied via blacklist.
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(401);
    expect(fixtures.tokenBlacklist.size()).toBeGreaterThan(0);
  });

  test('POST /password rejects wrong old password', async () => {
    const { app } = buildTestApp();
    await request(app).post('/api/v1/auth/register').send(creds);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'alice', password: creds.password });
    const res = await request(app)
      .post('/api/v1/auth/password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ oldPassword: 'wrong', newPassword: 'new-pass-12' });
    expect(res.status).toBe(401);
  });

  test('POST /password succeeds with right old password', async () => {
    const { app } = buildTestApp();
    await request(app).post('/api/v1/auth/register').send(creds);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'alice', password: creds.password });
    const res = await request(app)
      .post('/api/v1/auth/password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ oldPassword: creds.password, newPassword: 'new-pass-12' });
    expect(res.status).toBe(204);
  });

  test('Idempotency-Key replays first response on /register', async () => {
    const { app } = buildTestApp();
    const key = 'idem-key-1';
    const first = await request(app)
      .post('/api/v1/auth/register')
      .set('Idempotency-Key', key)
      .send(creds);
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/api/v1/auth/register')
      .set('Idempotency-Key', key)
      .send(creds);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
  });

  test('Idempotency-Key with different body returns 409', async () => {
    const { app } = buildTestApp();
    const key = 'idem-key-2';
    await request(app)
      .post('/api/v1/auth/register')
      .set('Idempotency-Key', key)
      .send(creds);
    const conflict = await request(app)
      .post('/api/v1/auth/register')
      .set('Idempotency-Key', key)
      .send({ ...creds, email: 'other@example.com' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('idempotency_conflict');
  });
});
