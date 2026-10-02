/**
 * conditional-requests.test.js — ETag / If-Match / If-None-Match on
 * workflows (roadmap #19, RFC 9110 §13).
 *
 * Lost update: two operators load the same workflow; one cancels it, the
 * other (looking at stale state) executes it. With If-Match the second
 * request gets 412 and re-reads instead of acting on a view that no longer
 * exists. Unconditional requests behave as before (backward compatible).
 */
import request from 'supertest';
import { bootstrap } from '../main.js';
import { versionEtag, parseIfMatch, expectedVersions, notModified } from '../../shared-kernel/infrastructure/etag.js';

describe('etag helpers', () => {
  test('versionEtag is a strong, quoted tag', () => {
    expect(versionEtag(0)).toBe('"v0"');
    expect(versionEtag(12)).toBe('"v12"');
  });

  test.each([
    [undefined, null],
    ['', null],
    ['*', { any: true }],
    ['"v3"', { versions: [3] }],
    ['"v1", "v2"', { versions: [1, 2] }],
    ['W/"v3"', { versions: [] }], // weak never matches If-Match (strong comparison)
    ['garbage', { versions: [] }],
  ])('parseIfMatch(%p) → %p', (h, want) => {
    expect(parseIfMatch(h)).toEqual(want);
  });

  test('expectedVersions: absent/* unconditional; unusable header can never match', () => {
    expect(expectedVersions(null)).toBeUndefined();
    expect(expectedVersions({ any: true })).toBeUndefined();
    expect(expectedVersions({ versions: [2, 5] })).toEqual([2, 5]);
    expect(expectedVersions({ versions: [] })).toEqual([-1]);
  });

  test('notModified uses weak comparison and honours *', () => {
    expect(notModified(undefined, '"v1"')).toBe(false);
    expect(notModified('"v1"', '"v1"')).toBe(true);
    expect(notModified('W/"v1"', '"v1"')).toBe(true);
    expect(notModified('"v0", "v1"', '"v1"')).toBe(true);
    expect(notModified('"v2"', '"v1"')).toBe(false);
    expect(notModified('*', '"v1"')).toBe(true);
  });
});

describe('workflow conditional requests (booted app)', () => {
  let booted;
  let auth;

  beforeAll(async () => {
    booted = await bootstrap({ JWT_SECRET: 'etag-secret', LOG_LEVEL: 'error', NODE_ENV: 'test', CORS_ORIGINS: 'http://spa.test' });
    const reg = await booted.ctx.identity.useCases.registerUser.execute({
      email: 'etag@example.com', username: 'etag_admin', password: 'Test-Password-123!', role: 'admin',
    });
    const { token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: reg.id, role: 'admin', sid: 'etag-sess' }, 900);
    auth = `Bearer ${token}`;
  });
  afterAll(() => booted?.shutdown());

  const create = async () => (await request(booted.app).post('/api/v1/workflows').set('Authorization', auth)
    .send({ template: 'data-analysis', context: {} }).expect(201)).body.data.workflow_id;
  const get = (id, headers = {}) => request(booted.app).get(`/api/v1/workflows/${id}`).set('Authorization', auth).set(headers);

  test('GET returns a strong version ETag; If-None-Match → 304', async () => {
    const id = await create();
    const res = await get(id).expect(200);
    expect(res.headers.etag).toMatch(/^"v\d+"$/);
    expect(res.headers.etag).toBe(versionEtag(res.body.data.workflow.version));
    await get(id, { 'If-None-Match': res.headers.etag }).expect(304);
    await get(id, { 'If-None-Match': '"v999"' }).expect(200);
  });

  test('lost update prevented: acting on a stale ETag → 412 with the current version', async () => {
    const id = await create();
    const stale = (await get(id)).headers.etag;

    // Operator A cancels using the current tag; gets the new tag back.
    const cancel = await request(booted.app).post(`/api/v1/workflows/${id}/cancel`).set('Authorization', auth)
      .set('If-Match', stale).send({ reason: 'not needed' }).expect(200);
    expect(cancel.headers.etag).toMatch(/^"v\d+"$/);
    expect(cancel.headers.etag).not.toBe(stale);

    // Operator B still holds the stale tag and tries to execute.
    const exec = await request(booted.app).post(`/api/v1/workflows/${id}/execute`).set('Authorization', auth)
      .set('If-Match', stale).send({});
    expect(exec.status).toBe(412);
    expect(JSON.stringify(exec.body)).toMatch(/PRECONDITION_FAILED/);
    expect(exec.body.current_version).toBe(Number(cancel.headers.etag.slice(2, -1)));
  });

  test('If-Match with the current tag, a list containing it, or * succeeds; weak tags never do', async () => {
    const id = await create();
    const tag = (await get(id)).headers.etag;
    await request(booted.app).post(`/api/v1/workflows/${id}/execute`).set('Authorization', auth)
      .set('If-Match', `W/${tag}`).send({}).expect(412);
    const ok = await request(booted.app).post(`/api/v1/workflows/${id}/execute`).set('Authorization', auth)
      .set('If-Match', `"v999", ${tag}`).send({});
    expect(ok.status).toBe(200);
    expect(ok.headers.etag).toMatch(/^"v\d+"$/);
    const id2 = await create();
    await request(booted.app).post(`/api/v1/workflows/${id2}/cancel`).set('Authorization', auth)
      .set('If-Match', '*').send({}).expect(200);
  });

  test('unconditional requests behave exactly as before', async () => {
    const id = await create();
    await request(booted.app).post(`/api/v1/workflows/${id}/cancel`).set('Authorization', auth).send({}).expect(200);
  });

  test('If-Match on a missing workflow is still 404 (not 412)', async () => {
    await request(booted.app).post('/api/v1/workflows/3f2b8c1e-9d4a-4e7b-8c2d-1a2b3c4d5e6f/cancel')
      .set('Authorization', auth).set('If-Match', '"v0"').send({}).expect(404);
  });

  test('browsers can read ETag cross-origin (CORS exposes it)', async () => {
    const id = await create();
    const res = await get(id, { Origin: 'http://spa.test' }).expect(200);
    expect(res.headers['access-control-expose-headers']).toMatch(/ETag/);
    expect(res.headers['access-control-expose-headers']).toMatch(/Idempotent-Replayed/);
  });
});
