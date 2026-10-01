/**
 * Transient DB failures → 503 + Retry-After on every error path (roadmap 21).
 */
import express from 'express';
import request from 'supertest';
import { isTransientDbError } from '../transient-errors.js';
import { problemDetailsMiddleware } from '../problem-details.js';
import { jsonErrorHandler } from '../../../bootstrap/http-hardening.js';
import { mapError as mapHuman } from '../../../contexts/human-interaction/interfaces/http/error-mapper.js';
import { mapErrorToHttp as mapIdentity } from '../../../contexts/identity-and-access/interfaces/http/error-mapper.js';
import { mapError as mapWorkflow } from '../../../contexts/workflow-orchestration/interfaces/http/error-mapper.js';

const pgErr = (code, message = 'x') => Object.assign(new Error(message), { code });

describe('isTransientDbError', () => {
  test.each(['57014', '55P03', '25P03', '57P01', '57P02', '57P03', '53300', '40001', '40P01', '08006', '08001'])(
    'SQLSTATE %s is transient', (code) => expect(isTransientDbError(pgErr(code))).toBe(true),
  );
  test.each([
    'timeout exceeded when trying to connect',
    'Connection terminated unexpectedly',
    'connect ECONNREFUSED 127.0.0.1:5432',
    'Query read timeout',
  ])('message %p is transient', (m) => expect(isTransientDbError(new Error(m))).toBe(true));

  test.each([
    ['unique violation', pgErr('23505')],
    ['invalid text repr', pgErr('22P02')],
    ['plain bug', new TypeError('x is undefined')],
    ['null', null],
    ['string', 'boom'],
    ['numeric code', Object.assign(new Error('e'), { code: 57014 })],
  ])('%s is not transient', (_l, e) => expect(isTransientDbError(e)).toBe(false));
});

describe('context error mappers', () => {
  const t = pgErr('57014', 'canceling statement due to statement timeout');
  test('human-interaction', () => {
    expect(mapHuman(t)).toEqual({ status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Temporarily unavailable; retry shortly' } } });
    expect(mapHuman(new Error('bug')).status).toBe(500);
  });
  test('identity', () => {
    expect(mapIdentity(t)).toEqual({ status: 503, body: { error: 'service_unavailable', message: 'Temporarily unavailable; retry shortly' } });
    expect(mapIdentity(new Error('bug'))).toBeNull();
  });
  test('workflow', () => {
    expect(mapWorkflow(t)).toEqual({ status: 503, body: { success: false, message: 'Temporarily unavailable; retry shortly', code: 'SERVICE_UNAVAILABLE' } });
    expect(mapWorkflow(new Error('bug')).status).toBe(500);
  });
  test('no internal detail (SQL, statement text) leaks into the body', () => {
    expect(JSON.stringify([mapHuman(t), mapIdentity(t), mapWorkflow(t)])).not.toMatch(/statement|cancel/i);
  });
});

describe('express error path', () => {
  const app = () => {
    const a = express();
    a.use(problemDetailsMiddleware());
    a.get('/transient', (_req, _res, next) => next(new Error('timeout exceeded when trying to connect')));
    a.get('/bug', (_req, _res, next) => next(new Error('bug')));
    a.get('/mapped', (_req, res) => res.status(503).json({ error: 'x' }));
    a.get('/explicit', (_req, res) => res.set('Retry-After', '30').status(503).json({ error: 'x' }));
    a.use(jsonErrorHandler({ logger: { error() {}, debug() {} } }));
    return a;
  };

  test('unhandled transient error → 503 problem+json with Retry-After', async () => {
    const res = await request(app()).get('/transient').expect(503);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('service_unavailable');
  });

  test('a real bug is still 500 without Retry-After', async () => {
    const res = await request(app()).get('/bug').expect(500);
    expect(res.headers['retry-after']).toBeUndefined();
  });

  test('mapper-produced 503s get Retry-After; an explicit value is kept', async () => {
    expect((await request(app()).get('/mapped').expect(503)).headers['retry-after']).toBe('1');
    expect((await request(app()).get('/explicit').expect(503)).headers['retry-after']).toBe('30');
  });
});
