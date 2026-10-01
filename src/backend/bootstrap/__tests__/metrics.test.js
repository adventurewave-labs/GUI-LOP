/**
 * metrics.test.js — Prometheus exposition, auth guard, and series content.
 */
import request from 'supertest';
import { bootstrap } from '../main.js';
import { createMetrics } from '../metrics.js';

const scrape = (app, token) => {
  const r = request(app).get('/metrics');
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

describe('/metrics (dev, no token)', () => {
  let booted;
  beforeAll(async () => {
    booted = await bootstrap({ JWT_SECRET: 'metrics-secret', LOG_LEVEL: 'error', NODE_ENV: 'test' });
  });
  afterAll(() => booted?.shutdown());

  test('serves Prometheus text with RED, outbox, ws and default series', async () => {
    await request(booted.app).get('/livez');
    await request(booted.app).get('/definitely-missing');
    const res = await scrape(booted.app);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain;.*version=0\.0\.4/);
    const body = res.text;
    expect(body).toMatch(/http_request_duration_seconds_count\{method="GET",route="\/livez",status_code="200"\} 1/);
    expect(body).toMatch(/route="unmatched",status_code="404"/);
    expect(body).toMatch(/^outbox_pending_events \d+/m);
    expect(body).toMatch(/^outbox_oldest_pending_age_seconds \d+/m);
    expect(body).toMatch(/^websocket_connections 0/m);
    expect(body).toMatch(/ai_circuit_state\{provider="stub",state="closed"\} 1/);
    expect(body).toMatch(/nodejs_eventloop_lag_seconds/);
  });

  test('raw paths never become labels (bounded cardinality)', async () => {
    await request(booted.app).get('/nope/123');
    await request(booted.app).get('/nope/456');
    const { text } = await scrape(booted.app);
    expect(text).not.toContain('/nope/123');
    expect(text).not.toContain('/nope/456');
  });

  test('AI stub calls are recorded', async () => {
    await booted.ctx.ui.aiProvider.healthCheck();
    const { text } = await scrape(booted.app);
    expect(text).toMatch(/ai_call_duration_seconds_count\{provider="stub",model="[^"]+",op="health_check",outcome="ok"\} 1/);
  });
});

describe('/metrics auth', () => {
  test('requires the bearer token when METRICS_TOKEN is set', async () => {
    const booted = await bootstrap({
      JWT_SECRET: 's', LOG_LEVEL: 'error', NODE_ENV: 'test', METRICS_TOKEN: 'scrape-me',
    });
    try {
      expect((await scrape(booted.app)).status).toBe(401);
      expect((await scrape(booted.app, 'wrong-token')).status).toBe(401);
      expect((await scrape(booted.app, 'scrape-me')).status).toBe(200);
    } finally {
      await booted.shutdown();
    }
  });

  test('fails closed in production without a token', async () => {
    const booted = await bootstrap({ JWT_SECRET: 'f3a91c0de57b2648a1d09e3c7b5f6a8210c4d7e9b3a5f1c2', LOG_LEVEL: 'error', NODE_ENV: 'production', ALLOW_EPHEMERAL_STATE: 'true' });
    try {
      expect((await scrape(booted.app)).status).toBe(404);
    } finally {
      await booted.shutdown();
    }
  });

  test('METRICS_ENABLED=false removes the endpoint', async () => {
    const booted = await bootstrap({ JWT_SECRET: 's', LOG_LEVEL: 'error', NODE_ENV: 'test', METRICS_ENABLED: 'false' });
    try {
      expect((await scrape(booted.app)).status).toBe(404);
    } finally {
      await booted.shutdown();
    }
  });
});

describe('createMetrics units', () => {
  test('onAITelemetry records outcome and normalises token shapes', async () => {
    const m = createMetrics({ defaultMetrics: false });
    m.onAITelemetry({ provider: 'anthropic', model: 'x', op: 'generate_ui', durationMs: 1200, ok: true, tokenUsage: { input_tokens: 10, output_tokens: 5 } });
    m.onAITelemetry({ provider: 'openai', model: 'y', op: 'classify', durationMs: 50, ok: true, tokenUsage: { prompt_tokens: 3, completion_tokens: 2 } });
    m.onAITelemetry({ provider: 'anthropic', model: 'x', op: 'generate_ui', durationMs: 30000, ok: false, errorName: 'AIProviderUnavailable' });
    const text = await m.registry.metrics();
    expect(text).toMatch(/ai_tokens_total\{provider="anthropic",model="x",direction="input"\} 10/);
    expect(text).toMatch(/ai_tokens_total\{provider="openai",model="y",direction="output"\} 2/);
    expect(text).toMatch(/outcome="AIProviderUnavailable"\} 1/);
  });

  test('outbox lookup failure surfaces as -1', async () => {
    const m = createMetrics({
      defaultMetrics: false,
      outbox: { getPendingCount: async () => { throw new Error('db down'); }, getOldestPendingAge: async () => 4500 },
    });
    const text = await m.registry.metrics();
    expect(text).toMatch(/^outbox_pending_events -1/m);
    expect(text).toMatch(/^outbox_oldest_pending_age_seconds 4\.5/m);
  });

  test('circuit state gauge reflects an open breaker', async () => {
    const m = createMetrics({ defaultMetrics: false, aiProvider: () => ({ name: 'openai', circuitState: 'open' }) });
    const text = await m.registry.metrics();
    expect(text).toMatch(/ai_circuit_state\{provider="openai",state="open"\} 1/);
    expect(text).toMatch(/ai_circuit_state\{provider="openai",state="closed"\} 0/);
  });
});
