#!/usr/bin/env node
/**
 * Post-deploy smoke test (roadmap P4). Exercises a running GUI-LOP API the
 * way a real user would and exits non-zero on the first broken step.
 *
 *   node scripts/smoke.mjs --base https://api.staging.example.com \
 *     [--metrics-token $METRICS_TOKEN] [--database-url $DATABASE_URL]
 *
 * (or SMOKE_BASE_URL / METRICS_TOKEN / SMOKE_DATABASE_URL env vars)
 *
 * Steps: liveness/readiness → /metrics auth → register (fresh user, strong
 * passphrase) → login → /me → list templates (built-ins present) → create
 * workflow → GET with ETag → execute (If-Match) → idempotent replay → the
 * transactional outbox drains (via /metrics, and — when a database URL is
 * given — the rows created by this run reach `dispatched`). No paid calls:
 * the AI provider is whatever the target runs (stub by default).
 */
import { randomUUID } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = (args.base ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const METRICS_TOKEN = args['metrics-token'] ?? process.env.METRICS_TOKEN ?? null;
const DATABASE_URL = args['database-url'] ?? process.env.SMOKE_DATABASE_URL ?? null;
const TIMEOUT_MS = Number(args.timeout ?? 10_000);

const results = [];
let failed = false;

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ step: name, ok: true, ms: Date.now() - t0, ...(detail ? { detail } : {}) });
    console.log(`✓ ${name} (${Date.now() - t0} ms)${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failed = true;
    results.push({ step: name, ok: false, ms: Date.now() - t0, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
    throw err;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, headers: res.headers, json, text };
}

const expectStatus = (r, want, what) =>
  assert(r.status === want, `${what}: expected ${want}, got ${r.status} ${r.text.slice(0, 300)}`);

async function metric(name) {
  const r = await call('GET', '/metrics', { headers: { authorization: `Bearer ${METRICS_TOKEN}` } });
  expectStatus(r, 200, '/metrics');
  const line = r.text.split('\n').find((l) => l.startsWith(`${name} `) || l.startsWith(`${name}{`));
  return line ? Number(line.trim().split(/\s+/).pop()) : null;
}

async function main() {
  console.log(`smoke → ${BASE}`);
  const runId = randomUUID().slice(0, 8);
  const user = {
    email: `smoke+${runId}@example.com`,
    username: `smoke_${runId}`,
    password: `smoke run ${runId} correct horse battery`,
  };
  let token; let workflowId; let etag;

  await step('liveness', async () => expectStatus(await call('GET', '/livez'), 200, '/livez'));
  await step('readiness (dependencies up)', async () => {
    const r = await call('GET', '/readyz');
    expectStatus(r, 200, '/readyz');
    return JSON.stringify(r.json?.checks ?? {});
  });
  await step('OpenAPI document served', async () => {
    const r = await call('GET', '/api/v1/openapi.json');
    expectStatus(r, 200, 'openapi.json');
    assert(r.json?.openapi?.startsWith('3.1') && Object.keys(r.json.paths ?? {}).length > 20, 'not an OpenAPI 3.1 document');
    return `${Object.keys(r.json.paths).length} paths, version ${r.json.info?.version}`;
  });
  if (METRICS_TOKEN) {
    await step('/metrics refuses anonymous scrapes', async () => {
      const r = await call('GET', '/metrics');
      assert(r.status === 401 || r.status === 404, `anonymous /metrics returned ${r.status}`);
    });
  }
  await step('register', async () => expectStatus(await call('POST', '/api/v1/auth/register', { body: user }), 201, 'register'));
  await step('weak password refused', async () => {
    const r = await call('POST', '/api/v1/auth/register', { body: { ...user, email: `w${user.email}`, username: `w${user.username}`, password: 'password1' } });
    expectStatus(r, 400, 'weak password');
  });
  await step('login', async () => {
    const r = await call('POST', '/api/v1/auth/login', { body: { identifier: user.username, password: user.password } });
    expectStatus(r, 200, 'login');
    token = r.json?.accessToken;
    assert(typeof token === 'string' && token.length > 20, 'no access token in login response');
  });
  await step('me', async () => {
    const r = await call('GET', '/api/v1/auth/me', { token });
    expectStatus(r, 200, '/me');
    assert(r.json?.username === user.username, 'me returned a different user');
  });
  await step('built-in templates present', async () => {
    const r = await call('GET', '/api/v1/workflows/templates', { token });
    expectStatus(r, 200, 'templates');
    const keys = (r.json?.data?.templates ?? []).map((t) => t.key ?? t.template_key ?? t.templateKey);
    assert(keys.includes('data-analysis'), `data-analysis template missing (got ${JSON.stringify(keys)})`);
    return `${keys.length} templates`;
  });
  await step('create workflow (ordinary user)', async () => {
    // Non-UUID correlation id on purpose: real callers send trace ids / ULIDs.
    const r = await call('POST', '/api/v1/workflows', { token, body: { template: 'data-analysis', context: { smoke: runId } }, headers: { 'Idempotency-Key': `smoke-${runId}`, 'X-Correlation-Id': `smoke-${runId}` } });
    expectStatus(r, 201, 'create workflow');
    workflowId = r.json?.data?.workflow_id;
    assert(workflowId, 'no workflow_id');
    const replay = await call('POST', '/api/v1/workflows', { token, body: { template: 'data-analysis', context: { smoke: runId } }, headers: { 'Idempotency-Key': `smoke-${runId}` } });
    expectStatus(replay, 201, 'idempotent replay');
    assert(replay.headers.get('idempotent-replayed') === 'true' && replay.json?.data?.workflow_id === workflowId, 'replay did not return the original workflow');
    return workflowId;
  });
  await step('read workflow (ETag)', async () => {
    const r = await call('GET', `/api/v1/workflows/${workflowId}`, { token });
    expectStatus(r, 200, 'get workflow');
    etag = r.headers.get('etag');
    assert(/^"v\d+"$/.test(etag ?? ''), `bad ETag ${etag}`);
  });
  await step('execute workflow (If-Match)', async () => {
    const r = await call('POST', `/api/v1/workflows/${workflowId}/execute`, { token, body: {}, headers: { 'If-Match': etag } });
    expectStatus(r, 200, 'execute');
    const stale = await call('POST', `/api/v1/workflows/${workflowId}/cancel`, { token, body: {}, headers: { 'If-Match': etag } });
    expectStatus(stale, 412, 'stale If-Match');
    return r.json?.data?.workflow?.status ?? r.json?.data?.status ?? 'executed';
  });
  if (METRICS_TOKEN) {
    await step('outbox drains', async () => {
      const deadline = Date.now() + 15_000;
      let pending = await metric('outbox_pending_events');
      while (pending !== 0 && Date.now() < deadline) {
        await new Promise((r) => { setTimeout(r, 500); });
        pending = await metric('outbox_pending_events');
      }
      assert(pending === 0, `outbox_pending_events still ${pending} after 15 s`);
      return 'pending=0';
    });
  }
  if (DATABASE_URL) {
    await step('this run\'s events reached dispatched (database)', async () => {
      const pg = (await import('pg')).default;
      const client = new pg.Client({ connectionString: DATABASE_URL });
      await client.connect();
      try {
        const deadline = Date.now() + 15_000;
        for (;;) {
          const { rows } = await client.query(
            `SELECT status, count(*)::int AS n FROM outbox WHERE aggregate_id = $1 GROUP BY status`,
            [workflowId],
          );
          const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
          const total = rows.reduce((a, r) => a + r.n, 0);
          if (total > 0 && (by.dispatched ?? 0) === total) return `${total} events dispatched`;
          if (Date.now() > deadline) throw new Error(`outbox rows for the workflow: ${JSON.stringify(by)}`);
          await new Promise((r) => { setTimeout(r, 500); });
        }
      } finally {
        await client.end();
      }
    });
    await step('audit trail: this run is recorded and the hash chain is intact (database)', async () => {
      const pg = (await import('pg')).default;
      const client = new pg.Client({ connectionString: DATABASE_URL });
      await client.connect();
      try {
        const { rows } = await client.query(
          `SELECT (SELECT count(*)::int FROM audit_events WHERE aggregate_id = $1) AS mine,
                  (SELECT count(*)::int FROM outbox WHERE aggregate_id = $1) AS emitted,
                  (SELECT count(*)::int FROM audit_events) AS entries,
                  audit_chain_first_break() AS broken`,
          [workflowId],
        );
        const { mine, emitted, entries, broken } = rows[0];
        assert(broken == null, `audit chain broken at seq ${broken}`);
        assert(mine > 0 && mine === emitted, `audit entries for the workflow: ${mine}, events emitted: ${emitted}`);
        return `${mine} entries for the workflow, chain of ${entries} intact`;
      } finally {
        await client.end();
      }
    });
  }
}

main()
  .catch(() => { failed = true; })
  .finally(() => {
    console.log(JSON.stringify({ base: BASE, ok: !failed, steps: results }));
    process.exit(failed ? 1 : 0);
  });
