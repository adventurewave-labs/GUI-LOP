#!/usr/bin/env node
/**
 * Dependency-free load test (roadmap P5). Closed-loop: N virtual users each
 * issue the next request as soon as the previous one returns, for a fixed
 * duration, against a running API. Reports throughput, latency percentiles
 * and status counts per scenario, and exits non-zero when an SLO is missed.
 *
 *   node scripts/load.mjs --base http://localhost:3001 \
 *     --scenario mixed --concurrency 20 --duration 20 \
 *     [--p95 250 --p99 600 --max-error-rate 0.01] [--json out.json]
 *
 * Scenarios
 *   health  GET /livez                         (framework floor)
 *   read    GET /api/v1/workflows/:id          (auth + 1 indexed read)
 *   write   POST /api/v1/workflows             (auth + txn + outbox rows)
 *   mixed   70 % read · 20 % templates · 10 % write   (interactive SPA use)
 *   login   POST /api/v1/auth/login            (bcrypt cost 12 — CPU bound)
 *
 * The target must allow the traffic: start it with a high RATE_LIMIT_MAX
 * (the default 600/min per IP would turn the run into a 429 test) — except
 * for `login`, whose limiter is the thing a real attacker meets; use
 * --allow-429 there to count 429 as expected.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const BASE = String(arg('base', process.env.LOAD_BASE_URL ?? 'http://localhost:3001')).replace(/\/$/, '');
const SCENARIO = arg('scenario', 'mixed');
const CONCURRENCY = Number(arg('concurrency', 20));
const DURATION_S = Number(arg('duration', 20));
const WARMUP_S = Number(arg('warmup', 3));
const SLO = {
  p95: arg('p95') ? Number(arg('p95')) : null,
  p99: arg('p99') ? Number(arg('p99')) : null,
  maxErrorRate: arg('max-error-rate') ? Number(arg('max-error-rate')) : null,
};
const ALLOW_429 = flag('allow-429');

async function http(method, path, { token, body } = {}) {
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    const text = await res.text();
    return { status, ms: performance.now() - t0, text };
  } catch (err) {
    return { status: 0, ms: performance.now() - t0, text: String(err?.message ?? err) };
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function setup() {
  const id = randomUUID().slice(0, 8);
  const user = { email: `load+${id}@example.com`, username: `load_${id}`, password: `load test ${id} long passphrase` };
  const reg = await http('POST', '/api/v1/auth/register', { body: user });
  if (reg.status !== 201) throw new Error(`setup: register → ${reg.status} ${reg.text.slice(0, 200)}`);
  const login = await http('POST', '/api/v1/auth/login', { body: { identifier: user.username, password: user.password } });
  if (login.status !== 200) throw new Error(`setup: login → ${login.status} ${login.text.slice(0, 200)}`);
  const token = JSON.parse(login.text).accessToken;
  const wf = await http('POST', '/api/v1/workflows', { token, body: { template: 'data-analysis', context: { load: id } } });
  if (wf.status !== 201) throw new Error(`setup: create workflow → ${wf.status} ${wf.text.slice(0, 200)}`);
  return { user, token, workflowId: JSON.parse(wf.text).data.workflow_id };
}

function pick(ctx) {
  const ops = {
    health: () => http('GET', '/livez'),
    read: () => http('GET', `/api/v1/workflows/${ctx.workflowId}`, { token: ctx.token }),
    templates: () => http('GET', '/api/v1/workflows/templates', { token: ctx.token }),
    write: () => http('POST', '/api/v1/workflows', { token: ctx.token, body: { template: 'data-analysis', context: {} } }),
    login: () => http('POST', '/api/v1/auth/login', { body: { identifier: ctx.user.username, password: ctx.user.password } }),
  };
  if (SCENARIO !== 'mixed') {
    if (!ops[SCENARIO]) throw new Error(`unknown scenario ${SCENARIO}`);
    return [SCENARIO, ops[SCENARIO]];
  }
  const r = Math.random();
  const name = r < 0.7 ? 'read' : r < 0.9 ? 'templates' : 'write';
  return [name, ops[name]];
}

async function main() {
  const ctx = SCENARIO === 'health' ? {} : await setup();
  const samples = []; // { op, ms, status }
  let measuring = false;
  const stopAt = Date.now() + (WARMUP_S + DURATION_S) * 1000;
  setTimeout(() => { measuring = true; }, WARMUP_S * 1000);

  const vu = async () => {
    while (Date.now() < stopAt) {
      const [op, run] = pick(ctx);
      // eslint-disable-next-line no-await-in-loop
      const r = await run();
      if (measuring) samples.push({ op, ms: r.ms, status: r.status });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, vu));

  const isError = (s) => s.status === 0 || s.status >= 500 || (s.status === 429 && !ALLOW_429) || (s.status >= 400 && s.status !== 429);
  const summarise = (rows) => {
    const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
    const statuses = {};
    for (const r of rows) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    const errors = rows.filter(isError).length;
    return {
      requests: rows.length,
      rps: +(rows.length / DURATION_S).toFixed(1),
      p50_ms: +(percentile(lat, 50) ?? 0).toFixed(1),
      p95_ms: +(percentile(lat, 95) ?? 0).toFixed(1),
      p99_ms: +(percentile(lat, 99) ?? 0).toFixed(1),
      max_ms: +(lat[lat.length - 1] ?? 0).toFixed(1),
      error_rate: rows.length ? +(errors / rows.length).toFixed(4) : 0,
      statuses,
    };
  };
  const byOp = {};
  for (const op of new Set(samples.map((s) => s.op))) byOp[op] = summarise(samples.filter((s) => s.op === op));
  const total = summarise(samples);

  const breaches = [];
  if (SLO.p95 != null && total.p95_ms > SLO.p95) breaches.push(`p95 ${total.p95_ms} ms > ${SLO.p95} ms`);
  if (SLO.p99 != null && total.p99_ms > SLO.p99) breaches.push(`p99 ${total.p99_ms} ms > ${SLO.p99} ms`);
  if (SLO.maxErrorRate != null && total.error_rate > SLO.maxErrorRate) breaches.push(`error rate ${total.error_rate} > ${SLO.maxErrorRate}`);
  if (total.requests === 0) breaches.push('no requests completed');

  const report = { base: BASE, scenario: SCENARIO, concurrency: CONCURRENCY, duration_s: DURATION_S, total, byOp, slo: SLO, breaches };
  console.log(JSON.stringify(report, null, 2));
  if (arg('json')) writeFileSync(arg('json'), JSON.stringify(report, null, 2));
  process.exit(breaches.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`load test failed: ${err.message}`);
  process.exit(2);
});
