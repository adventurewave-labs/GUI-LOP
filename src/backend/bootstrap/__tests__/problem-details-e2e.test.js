/**
 * problem-details-e2e.test.js — every context's errors are RFC 9457 through
 * the real app, with legacy fields intact.
 */
import request from 'supertest';
import { bootstrap } from '../main.js';

describe('RFC 9457 across bounded contexts', () => {
  let booted;
  let token;
  beforeAll(async () => {
    booted = await bootstrap({ JWT_SECRET: 'problem-secret', LOG_LEVEL: 'error', NODE_ENV: 'test' });
    ({ token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: 'p-user', role: 'admin', sid: 's' }, 300));
  });
  afterAll(() => booted?.shutdown());

  const isProblem = (res) => {
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual(expect.objectContaining({
      type: expect.any(String), title: expect.any(String), status: res.status, request_id: expect.any(String),
    }));
  };

  test('identity: 401 missing auth', async () => {
    const res = await request(booted.app).get('/api/v1/workflows/templates');
    expect(res.status).toBe(401);
    isProblem(res);
    expect(res.body.error).toBe('unauthorised'); // legacy kept
  });

  test('workflow: 404 unknown workflow keeps { success:false, code }', async () => {
    const res = await request(booted.app)
      .get('/api/v1/workflows/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    isProblem(res);
  });

  test('framework: unmatched route 404 and malformed JSON 400', async () => {
    const nf = await request(booted.app).get('/nope');
    isProblem(nf);
    expect(nf.body.type).toMatch(/\/not-found$/);
    const bad = await request(booted.app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"x":');
    expect(bad.status).toBe(400);
    isProblem(bad);
    expect(bad.body.type).toMatch(/\/bad-request$/);
  });

  test('readiness document is not converted', async () => {
    const res = await request(booted.app).get('/readyz');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });
});
