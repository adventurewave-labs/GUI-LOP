/**
 * Password policy over HTTP on the booted app (roadmap 23 / P2): weak
 * passwords are refused at registration and password change with a
 * machine-readable reason; good passphrases (no composition rules) pass.
 */
import request from 'supertest';
import { bootstrap } from '../main.js';

describe('password policy (booted app)', () => {
  let booted;
  beforeAll(async () => {
    booted = await bootstrap({ JWT_SECRET: 'pp-secret', LOG_LEVEL: 'error', NODE_ENV: 'test' });
  });
  afterAll(() => booted?.shutdown());

  const register = (body) => request(booted.app).post('/api/v1/auth/register').send(body);
  let n = 0;
  const user = (password) => ({ email: `pp${++n}@example.com`, username: `pp_user_${n}`, password });

  test.each([
    ['short-pass', 'too_short'],
    ['passwordpassword', 'common'],
    ['abcdefghijklmnopq', 'repetitive'],
  ])('register %p → 400 (%s)', async (pw, reason) => {
    const res = await register(user(pw)).expect(400);
    expect(res.body.reason).toBe(reason);
    expect(res.body.field).toBe('password');
    expect(JSON.stringify(res.body)).not.toContain(pw);
  });

  test('a password based on the username is refused', async () => {
    const res = await register({ email: 'ctx@example.com', username: 'stephanie_k', password: 'stephanie_k 2026!' }).expect(400);
    expect(res.body.reason).toBe('contains_context');
  });

  test('a plain lowercase passphrase is accepted (no composition rules), and change-password applies the policy', async () => {
    const creds = user('correct horse battery staple');
    await register(creds).expect(201);
    const login = await request(booted.app).post('/api/v1/auth/login')
      .send({ identifier: creds.username, password: creds.password }).expect(200);
    const auth = `Bearer ${login.body.accessToken}`;
    const weak = await request(booted.app).post('/api/v1/auth/password').set('Authorization', auth)
      .send({ oldPassword: creds.password, newPassword: 'qwertyuiopasdfgh' });
    expect(weak.status).toBe(400);
    expect(weak.body.field).toBe('newPassword');
    await request(booted.app).post('/api/v1/auth/password').set('Authorization', auth)
      .send({ oldPassword: creds.password, newPassword: 'a different long passphrase' }).expect(204);
  });
});
