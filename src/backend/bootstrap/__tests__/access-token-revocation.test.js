/**
 * access-token-revocation.test.js — revoking a session revokes its access
 * tokens (roadmap 17b).
 *
 * Before: logout blacklisted only the access token that made the request, so
 * the same session's tokens in other tabs/devices kept working for up to the
 * access TTL; refresh-token reuse revoked the session but none of its tokens.
 */
import request from 'supertest';
import { bootstrap } from '../main.js';
import {
  accessTokenRevocation,
  sessionRevocationKey,
  withAccessTokenRevocation,
} from '../../contexts/identity-and-access/application/services/access-token-revocation.js';
import { InMemoryTokenBlacklist } from '../../contexts/identity-and-access/infrastructure/cache/inmemory-token-blacklist.js';
import { makeWsPrincipalResolver } from '../../contexts/identity-and-access/interfaces/websocket/ws-principal-resolver.js';

const PASSWORD = 'Sup3r-Secret-Pass!';

describe('session revocation kills outstanding access tokens (booted app)', () => {
  let booted;
  beforeEach(async () => {
    booted = await bootstrap({ JWT_SECRET: 'revocation-secret', LOG_LEVEL: 'error', NODE_ENV: 'test' });
    await request(booted.app).post('/api/v1/auth/register')
      .send({ email: 'tabs@example.com', username: 'tabs', password: PASSWORD }).expect(201);
  });
  afterEach(() => booted?.shutdown());

  const login = async () => (await request(booted.app).post('/api/v1/auth/login')
    .send({ identifier: 'tabs@example.com', password: PASSWORD }).expect(200)).body;
  const me = (token) => request(booted.app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

  test('logout in one tab invalidates the same session’s token in another tab', async () => {
    const s = await login();
    const tabA = s.accessToken;
    const tabB = (await request(booted.app).post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200)).body.accessToken;
    await me(tabA).expect(200);
    await me(tabB).expect(200);

    await request(booted.app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${tabB}`).expect((r) => {
      expect(r.status).toBeLessThan(300);
    });

    const res = await me(tabA);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/Session has been revoked/);
  });

  test('other sessions of the same user are unaffected', async () => {
    const one = await login();
    const two = await login();
    await request(booted.app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${one.accessToken}`);
    await me(two.accessToken).expect(200);
  });

  test('refresh-token reuse also kills the session’s live access tokens', async () => {
    const s = await login();
    await request(booted.app).post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
    await me(s.accessToken).expect(200);
    await request(booted.app).post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401); // replay
    await me(s.accessToken).expect(401);
  });
});

describe('accessTokenRevocation', () => {
  test('distinguishes token vs session revocation; tolerates missing blacklist/claims', async () => {
    const bl = new InMemoryTokenBlacklist();
    await bl.blacklist('jti-1', 60);
    await bl.blacklist(sessionRevocationKey('sid-1'), 60);
    expect(await accessTokenRevocation({ jti: 'jti-1', sid: 'sid-9' }, bl)).toBe('token');
    expect(await accessTokenRevocation({ jti: 'jti-2', sid: 'sid-1' }, bl)).toBe('session');
    expect(await accessTokenRevocation({ jti: 'jti-2', sid: 'sid-2' }, bl)).toBe(false);
    expect(await accessTokenRevocation({}, bl)).toBe(false);
    expect(await accessTokenRevocation({ sid: 'sid-1' }, null)).toBe(false);
    expect(sessionRevocationKey('x')).toBe('sid:x');
  });
});

describe('withAccessTokenRevocation decorator', () => {
  const make = () => {
    const calls = [];
    const inner = {
      saved: [],
      async save(s) { this.saved.push(s.id); },
      async revoke(id) { this.saved.push(`revoked:${id}`); },
      async findById(id) { return { id, from: this.saved.length }; },
    };
    const bl = { blacklist: async (k, ttl) => { calls.push([k, ttl]); } };
    return { inner, calls, repo: withAccessTokenRevocation(inner, bl, { accessTtlSeconds: 900.7 }) };
  };

  test('only inactive sessions are blacklisted, for one access-token lifetime', async () => {
    const { inner, calls, repo } = make();
    await repo.save({ id: 's1', isActive: true });
    await repo.save({ id: 's2', isActive: false });
    expect(inner.saved).toEqual(['s1', 's2']);
    expect(calls).toEqual([['sid:s2', 900]]);
  });

  test('revoke() is covered too; other methods pass through bound to the target', async () => {
    const { inner, calls, repo } = make();
    await repo.revoke('s3');
    expect(inner.saved).toEqual(['revoked:s3']);
    expect(calls).toEqual([['sid:s3', 900]]);
    expect(await repo.findById('z')).toEqual({ id: 'z', from: 1 });
  });

  test('a failed save never blacklists', async () => {
    const calls = [];
    const repo = withAccessTokenRevocation(
      { save: async () => { throw new Error('db down'); } },
      { blacklist: async (k) => { calls.push(k); } },
      { accessTtlSeconds: 60 },
    );
    await expect(repo.save({ id: 's', isActive: false })).rejects.toThrow('db down');
    expect(calls).toEqual([]);
  });
});

describe('WebSocket upgrades honour session revocation', () => {
  test('resolver rejects a token whose session is revoked', async () => {
    const bl = new InMemoryTokenBlacklist();
    const tokenIssuer = { verifyAccess: async () => ({ sub: 'u1', role: 'user', sid: 'sess-1', jti: 'j1', exp: 9e9 }) };
    const resolve = makeWsPrincipalResolver({ tokenIssuer, tokenBlacklist: bl });
    const req = { headers: { authorization: 'Bearer abc' }, url: '/ws/v1' };
    expect(await resolve(req)).toEqual(expect.objectContaining({ id: 'u1', sessionId: 'sess-1' }));
    await bl.blacklist(sessionRevocationKey('sess-1'), 60);
    expect(await resolve(req)).toBeNull();
  });
});
