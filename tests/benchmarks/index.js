/**
 * tests/benchmarks/index.js — top-level benchmark entry.
 *
 * Runs every scenario sequentially against a single bootstrap (where it
 * makes sense) and emits two artifacts under `tests/benchmarks/results/`:
 *   - `latest.json`              raw machine-readable result set
 *   - `latest.md`                per-scenario PASS/FAIL table vs. ADR 0021 SLOs
 *
 * Run: `npm run bench` (or `node tests/benchmarks/index.js`).
 *
 * The whole suite is sized to finish in well under 60 seconds on a typical
 * dev box; bcrypt-bound auth benches are intentionally short.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { suite, report, compareToSlo, RESULTS_DIR, SLO_BUDGETS } from './runner.js';

import { bootBenchApp as bootWorkflowApp, buildWorkflowBenches } from './scenarios/workflow-throughput.bench.js';
import { bootBenchApp as bootAuthApp, buildAuthBenches } from './scenarios/auth-throughput.bench.js';
import { buildRepositoryBenches } from './scenarios/repository-throughput.bench.js';
import { buildEventbusBenches } from './scenarios/eventbus-throughput.bench.js';
import { buildDomainBenches } from './scenarios/domain-purity.bench.js';

async function main() {
  const startedAt = Date.now();
  const all = [];

  /* ---- domain (no bootstrap) ---- */
  {
    const benches = buildDomainBenches();
    const results = await suite({ name: 'domain-purity', benches });
    all.push(...results);
  }

  /* ---- repository (no bootstrap) ---- */
  {
    const benches = buildRepositoryBenches();
    const results = await suite({ name: 'repository-throughput', benches });
    all.push(...results);
  }

  /* ---- eventbus (no bootstrap) ---- */
  {
    const benches = buildEventbusBenches();
    const results = await suite({ name: 'eventbus-throughput', benches });
    all.push(...results);
  }

  /* ---- workflow HTTP (own bootstrap) ---- */
  {
    const env = await bootWorkflowApp();
    try {
      const benches = buildWorkflowBenches(env);
      const results = await suite({ name: 'workflow-throughput', benches });
      all.push(...results);
    } finally {
      await env.booted.shutdown();
    }
  }

  /* ---- auth HTTP (own bootstrap; bcrypt is heavy) ---- */
  {
    const env = await bootAuthApp();
    try {
      const benches = buildAuthBenches(env);
      const results = await suite({ name: 'auth-throughput', benches });
      all.push(...results);
    } finally {
      await env.booted.shutdown();
    }
  }

  const elapsedMs = Date.now() - startedAt;

  // Console pretty print + JSON results.
  await report(all, {
    format: 'both',
    file: 'latest.json',
    meta: { totalElapsedMs: elapsedMs },
  });

  // Markdown summary with PASS/FAIL vs. SLO.
  await mkdir(RESULTS_DIR, { recursive: true });
  const md = renderMarkdown(all, elapsedMs);
  await writeFile(join(RESULTS_DIR, 'latest.md'), md, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`\nWrote ${all.length} results to ${RESULTS_DIR}/latest.json + latest.md`);
  // eslint-disable-next-line no-console
  console.log(`Total elapsed: ${(elapsedMs / 1000).toFixed(2)} s`);
}

/* ---------------- markdown rendering ---------------- */

function renderMarkdown(results, elapsedMs) {
  const groups = new Map();
  for (const r of results) {
    const key = r.suite ?? '(unknown)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const lines = [];
  lines.push('# GUI-LOP Benchmark Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Node: ${process.version} (${process.platform}/${process.arch})`);
  lines.push(`Total elapsed: ${(elapsedMs / 1000).toFixed(2)} s`);
  lines.push('');
  lines.push('SLO references: ADR 0021 (observability).');
  lines.push('');

  // Aggregate PASS/FAIL counts.
  let pass = 0;
  let fail = 0;
  let na = 0;
  for (const r of results) {
    const c = compareToSlo(r);
    if (c.status === 'PASS') pass += 1;
    else if (c.status === 'FAIL') fail += 1;
    else na += 1;
  }
  lines.push(`**Summary:** ${pass} PASS · ${fail} FAIL · ${na} N/A (of ${results.length} benches)`);
  lines.push('');

  for (const [suiteName, suiteResults] of groups) {
    lines.push(`## ${suiteName}`);
    lines.push('');
    lines.push('| Scenario | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | OPS/sec | SLO | Status |');
    lines.push('|---|---:|---:|---:|---:|---:|---|---|');
    for (const r of suiteResults) {
      const c = compareToSlo(r);
      const sloLabel = c.slo ?? '—';
      lines.push(
        `| \`${r.name}\` | ${msFmt(r.mean)} | ${msFmt(r.p50)} | ${msFmt(r.p95)} | ${msFmt(r.p99)} | ${r.opsPerSec.toFixed(1)} | ${sloLabel} | ${badge(c)} |`,
      );
    }
    lines.push('');
  }

  // Tail: list the SLOs we tracked for transparency.
  lines.push('## SLO budgets');
  lines.push('');
  lines.push('| Bench | Metric | Budget |');
  lines.push('|---|---|---|');
  for (const [name, slo] of Object.entries(SLO_BUDGETS)) {
    lines.push(`| \`${name}\` | ${slo.metric} | ${slo.human} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function msFmt(us) {
  return (Number(us) / 1000).toFixed(3);
}

function badge(c) {
  if (c.status === 'PASS') return 'PASS';
  if (c.status === 'FAIL') {
    const overByMs = (c.overBy / 1000).toFixed(2);
    return `FAIL (+${overByMs} ms)`;
  }
  return 'N/A';
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('benchmark suite failed:', err);
  process.exit(1);
});
