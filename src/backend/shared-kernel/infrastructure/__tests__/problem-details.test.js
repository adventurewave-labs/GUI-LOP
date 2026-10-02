/**
 * problem-details.test.js — RFC 9457 conversion of legacy envelopes.
 */
import express from 'express';
import request from 'supertest';
import { toProblem, codeSlug, legacyCode, problemDetailsMiddleware, PROBLEM_TYPE_BASE } from '../problem-details.js';

describe('toProblem', () => {
  test('identity envelope { error, message }', () => {
    const p = toProblem(401, { error: 'invalid_credentials', message: 'Bad creds' }, { instance: '/api/v1/auth/login', requestId: 'r1' });
    expect(p).toEqual({
      type: `${PROBLEM_TYPE_BASE}invalid-credentials`,
      title: 'Unauthorized',
      status: 401,
      detail: 'Bad creds',
      instance: '/api/v1/auth/login',
      code: 'invalid_credentials',
      request_id: 'r1',
      error: 'invalid_credentials',
      message: 'Bad creds',
    });
  });

  test('human-interaction envelope { error: { code, message, details } }', () => {
    const body = { error: { code: 'INVALID_RESPONSE', message: 'nope', details: { f: 1 } } };
    const p = toProblem(422, body);
    expect(p.type).toBe(`${PROBLEM_TYPE_BASE}invalid-response`);
    expect(p.detail).toBe('nope');
    expect(p.code).toBe('INVALID_RESPONSE');
    expect(p.error).toEqual(body.error); // legacy preserved
  });

  test('workflow envelope { success:false, message, code }', () => {
    const p = toProblem(404, { success: false, message: 'missing', code: 'NOT_FOUND' });
    expect(p).toEqual(expect.objectContaining({
      type: `${PROBLEM_TYPE_BASE}not-found`, title: 'Not Found', status: 404, detail: 'missing', success: false,
    }));
  });

  test('no code → about:blank; RFC status always wins over a legacy numeric status', () => {
    const p = toProblem(500, { status: 200 });
    expect(p.type).toBe('about:blank');
    expect(p.status).toBe(500);
  });

  test('helpers', () => {
    expect(codeSlug('  STEP__Not Pending!! ')).toBe('step-not-pending');
    expect(legacyCode({})).toBeUndefined();
    expect(legacyCode(null)).toBeUndefined();
  });
});

describe('problemDetailsMiddleware', () => {
  const app = express();
  app.use((req, _res, next) => { req.id = 'rid-1'; next(); });
  app.use(problemDetailsMiddleware());
  app.get('/ok', (_req, res) => res.json({ ok: true }));
  app.get('/err', (_req, res) => res.status(409).json({ error: 'conflict', message: 'dup' }));
  app.get('/arr', (_req, res) => res.status(400).json([1, 2]));
  app.get('/health', (_req, res) => res.status(503).json({ status: 'draining', checks: {} }));
  app.get('/q', (_req, res) => res.status(400).json({ error: 'bad' }));

  test('2xx untouched', async () => {
    const res = await request(app).get('/ok');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ ok: true });
  });

  test('error → application/problem+json with request_id', async () => {
    const res = await request(app).get('/err');
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual(expect.objectContaining({ type: `${PROBLEM_TYPE_BASE}conflict`, title: 'Conflict', status: 409, instance: '/err', request_id: 'rid-1', error: 'conflict' }));
  });

  test('instance never includes the query string', async () => {
    const res = await request(app).get('/q?token=secret');
    expect(res.body.instance).toBe('/q');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  test('arrays and health documents are left alone', async () => {
    expect((await request(app).get('/arr')).body).toEqual([1, 2]);
    const h = await request(app).get('/health');
    expect(h.body).toEqual({ status: 'draining', checks: {} });
    expect(h.headers['content-type']).toMatch(/^application\/json/);
  });
});
