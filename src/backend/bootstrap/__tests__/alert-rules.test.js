/**
 * Prometheus alert rules (roadmap P10).
 *
 * The previous rules referenced metrics the application never exported
 * (`http_requests_total`, `workflow_processing_duration_seconds`,
 * `active_workflows_total`, `auth_failures_total`), so the error-rate alert
 * could never fire. These tests make that impossible to repeat: every metric
 * and label an API alert uses must exist in the app's real /metrics output,
 * and every alert links to a runbook section that exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yamljs';
import { createMetrics } from '../metrics.js';
import { InMemoryOutbox } from '../../shared-kernel/infrastructure/inmemory-outbox.js';

const ROOT = path.resolve(__dirname, '../../../..');
const rules = YAML.load(path.join(ROOT, 'docker/monitoring/gui-lop-rules.yml'));
const prometheus = YAML.load(path.join(ROOT, 'docker/monitoring/prometheus.yml'));
const runbook = fs.readFileSync(path.join(ROOT, 'docs/RUNBOOK.md'), 'utf8');
const all = rules.groups.flatMap((g) => g.rules.map((r) => ({ group: g.name, ...r })));
const api = all.filter((r) => r.group === 'gui-lop-api');

const PROMQL_WORDS = new Set(['sum', 'rate', 'by', 'le', 'or', 'and', 'histogram_quantile', 'changes', 'avg', 'max', 'min', 'on', 'without', 'route']);
/** Metric names used by an expression (label matchers and durations removed). */
function metricsIn(expr) {
  const bare = expr.replace(/\{[^}]*\}/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/"[^"]*"/g, ' ');
  return [...new Set((bare.match(/[a-zA-Z_:][a-zA-Z0-9_:]*/g) ?? []).filter((w) => !PROMQL_WORDS.has(w) && !/^\d/.test(w)))];
}
/** [metric, label] pairs used in selectors. */
function labelsIn(expr) {
  const out = [];
  for (const m of expr.matchAll(/([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}/g)) {
    for (const l of m[2].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=~|!~|!=|=)/g)) out.push([m[1], l[1]]);
  }
  return out;
}
const base = (name) => name.replace(/_(bucket|count|sum)$/, '');

describe('alert rules — structure', () => {
  test('every alert has an expression, a severity, a summary and a description', () => {
    expect(all.length).toBeGreaterThan(20);
    for (const r of all) {
      expect({ alert: r.alert, expr: typeof r.expr === 'string' && r.expr.length > 3, severity: ['warning', 'critical'].includes(r.labels?.severity), summary: Boolean(r.annotations?.summary), description: Boolean(r.annotations?.description) })
        .toEqual({ alert: r.alert, expr: true, severity: true, summary: true, description: true });
    }
    expect(new Set(all.map((r) => r.alert)).size).toBe(all.length);
  });

  test('the phantom-metric alerts are gone', () => {
    const text = JSON.stringify(all);
    for (const ghost of ['http_requests_total', 'workflow_processing_duration_seconds', 'active_workflows_total', 'auth_failures_total']) {
      expect(text).not.toContain(ghost);
    }
  });

  test('what matters is covered: availability, errors, latency, overload, outbox lag, dead letters, pool, AI', () => {
    const names = api.map((r) => r.alert);
    for (const n of ['ApiDown', 'ApiHighErrorRate', 'ApiLatencyP95High', 'ApiLatencyP99High', 'ApiOverloaded', 'ApiRestarting', 'DbPoolSaturated', 'OutboxLagHigh', 'OutboxStalled', 'OutboxDeadLetters', 'AiCircuitOpen']) {
      expect(names).toContain(n);
    }
  });

  test('every API alert links to a runbook section that exists', () => {
    const anchors = new Set([...runbook.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim().toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')));
    for (const r of api) {
      const m = /RUNBOOK\.md#([a-z0-9-]+)$/.exec(r.annotations.runbook_url ?? '');
      expect({ alert: r.alert, anchor: m?.[1], exists: anchors.has(m?.[1]) }).toEqual({ alert: r.alert, anchor: m?.[1], exists: true });
    }
  });

  test('Prometheus authenticates the backend scrape and scrapes only paths that exist', () => {
    const backend = prometheus.scrape_configs.find((j) => j.job_name === 'gui-lop-backend');
    expect(backend.metrics_path).toBe('/metrics');
    expect(backend.authorization).toEqual({ type: 'Bearer', credentials_file: '/etc/prometheus/secrets/metrics_token' });
    expect(prometheus.scrape_configs.map((j) => j.metrics_path)).not.toContain('/api/metrics');
    expect(prometheus.rule_files).toEqual(['gui-lop-rules.yml']);
  });
});

describe('alert rules ↔ the metrics the app really exports', () => {
  let exported; let labelNames;

  beforeAll(async () => {
    const outbox = new InMemoryOutbox();
    const m = createMetrics({
      outbox,
      wsConnectionCount: () => 0,
      dbPool: () => ({ total: 1, idle: 1, waiting: 0, max: 10 }),
      aiProvider: () => ({ name: 'stub', circuitState: 'closed' }),
    });
    m.onAITelemetry?.({ provider: 'stub', model: 'm', op: 'generate', ok: true, durationMs: 5 });
    const json = await m.registry.getMetricsAsJSON();
    exported = new Set(json.map((x) => x.name));
    labelNames = new Map(json.map((x) => [x.name, new Set([...(m.registry.getSingleMetric(x.name)?.labelNames ?? []), 'job', 'instance', 'le'])]));
    m.registry.clear();
  });

  test('every metric used by an API alert is exported', () => {
    const missing = [];
    for (const r of api) {
      for (const name of metricsIn(r.expr)) {
        if (name === 'up') continue; // synthesised by Prometheus
        if (!exported.has(name) && !exported.has(base(name))) missing.push(`${r.alert}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('every label an API alert selects on exists on that metric', () => {
    const wrong = [];
    for (const r of api) {
      for (const [metric, label] of labelsIn(r.expr)) {
        if (metric === 'up') continue;
        const known = labelNames.get(metric) ?? labelNames.get(base(metric));
        if (!known?.has(label)) wrong.push(`${r.alert}: ${metric}{${label}}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test('label VALUES the alerts depend on are the ones the app emits', async () => {
    const outbox = new InMemoryOutbox();
    const m = createMetrics({ outbox, dbPool: () => ({ total: 2, idle: 0, waiting: 3, max: 2 }), aiProvider: () => ({ name: 'stub', circuitState: 'open' }), defaultMetrics: false });
    m.onAITelemetry?.({ provider: 'stub', model: 'm', op: 'generate', ok: true, durationMs: 5 });
    const text = await m.registry.metrics();
    expect(text).toMatch(/db_pool_connections\{state="waiting"\} 3/);       // DbPoolSaturated
    expect(text).toMatch(/ai_circuit_state\{[^}]*state="open"[^}]*\} 1/);    // AiCircuitOpen
    expect(text).toMatch(/ai_call_duration_seconds_count\{[^}]*outcome="ok"/); // AiErrorRateHigh uses outcome!="ok"
    expect(text).toMatch(/outbox_dead_letter_events 0/);                     // OutboxDeadLetters
    expect(api.find((r) => r.alert === 'AiErrorRateHigh').expr).toContain('outcome!="ok"');
  });

  test('outbox_dead_letter_events counts dead-lettered events', async () => {
    const outbox = { getPendingCount: async () => 0, getOldestPendingAge: async () => 0, getDeadLetterCount: async () => 4 };
    const text = await createMetrics({ outbox, defaultMetrics: false }).registry.metrics();
    expect(text).toMatch(/outbox_dead_letter_events 4/);
    const broken = { getPendingCount: async () => 0, getOldestPendingAge: async () => 0, getDeadLetterCount: async () => { throw new Error('db down'); } };
    expect(await createMetrics({ outbox: broken, defaultMetrics: false }).registry.metrics()).toMatch(/outbox_dead_letter_events -1/);
  });
});
