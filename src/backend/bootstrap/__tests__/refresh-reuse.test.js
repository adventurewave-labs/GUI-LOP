/**
 * refresh-reuse.test.js — refresh-token rotation + reuse detection, end to end
 * (roadmap #17, RFC 9700 §4.14.2).
 *
 * Tokens already rotated on each refresh, but replaying a superseded token
 * just got a 401 and left the session alive — so if it leaked, the attacker
 * or the victim kept a working newer token and nobody noticed. Now replay
 * revokes the whole session and is reported distinctly.
 */
import request from 'supertest';
import { bootstrap } from '../main.js';

const PASSWORD = 'Sup3r-Secret-Pass!';

describe('refresh token reuse detection (booted app)', () => {
  let booted;
  beforeEach(async () => {
    booted = await bootstrap({ JWT_SECRET: 'reuse-secret', LOG_LEVEL: 'error', NODE_ENV: 'test' });
    await request(booted.app).post('/api/v1/auth/register')
      .send({ email: 'reuse@example.com', username: 'reuser', password: PASSWORD }).expect(201);
  });
  afterEach(() => booted?.shutdown());

  const login = async () => (await request(booted.app).post('/api/v1/auth/login')
    .send({ identifier: 'reuse@example.com', password: PASSWORD }).expect(200)).body;
  const refresh = (refreshToken) => request(booted.app).post('/api/v1/auth/refresh').send({ refreshToken });

  test('each refresh rotates; the previous token stops working', async () => {
    const { refreshToken: t1 } = await login();
    const r1 = await refresh(t1).expect(200);
    const t2 = r1.body.refreshToken;
    expect(t2).toBeTruthy();
    expect(t2).not.toBe(t1);
    const r2 = await refresh(t2).expect(200);
    expect(r2.body.refreshToken).not.toBe(t2);
  });

  test('replaying a superseded token revokes the whole session (descendants included)', async () => {
    const { refreshToken: t1 } = await login();
    const t2 = (await refresh(t1).expect(200)).body.refreshToken;
    const t3 = (await refresh(t2).expect(200)).body.refreshToken;

    // Attacker (or a confused client) replays t1:
    const replay = await refresh(t1);
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('refresh_token_reused');

    // The legitimate holder's newest token is dead too — the family is gone.
    const after = await refresh(t3);
    expect(after.status).toBe(401);
    expect(after.body.error).toBe('session_revoked');

    // A fresh login still works (other sessions are unaffected).
    const again = await login();
    await refresh(again.refreshToken).expect(200);
  });

  test('replay is recorded as a security event', async () => {
    const { refreshToken: t1 } = await login();
    await refresh(t1).expect(200);
    await refresh(t1).expect(401);
    const outbox = booted.ctx.identity.outbox;
    const types = (outbox.events ?? outbox._events ?? []).map((e) => e.eventType ?? e.type);
    expect(types).toEqual(expect.arrayContaining(['session.refresh_token_reused', 'session.revoked']));
  });

  test('an unknown token is still a plain invalid_credentials (no oracle)', async () => {
    const res = await refresh('glop_rt_not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });
});
