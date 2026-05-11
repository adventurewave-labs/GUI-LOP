/**
 * runner.js — micro-benchmark harness for the GUI-LOP SLO suite.
 *
 * Designed for measurement only (no optimization, no statistical
 * significance testing). Provides three primitives:
 *
 *   - `bench({name, warmup, iterations, fn})` runs `fn` `warmup`+`iterations`
 *     times, captures per-iteration wall-clock samples via
 *     `process.hrtime.bigint()`, and returns summary statistics
 *     (`mean`, `p50`, `p95`, `p99`, `max`, `min`, `opsPerSec`, `samples`).
 *
 *   - `suite({name, benches})` runs a list of bench definitions sequentially
 *     and returns the array of results. Each entry can be either a
 *     `BenchDefinition` `{name, warmup?, iterations?, setup?, fn, teardown?}`
 *     or an already-shaped result (passed through unchanged).
 *
 *   - `report(results, {format, file})` pretty-prints to console (default)
 *     or writes a JSON document under `tests/benchmarks/results/` (timestamped
 *     plus a stable `latest.json`).
 *
 * No external deps; pure ESM. Designed to run on Node >= 18.
 *
 * SLO map (used by `compareToSlo`):
 *   - Workflow read p95   < 250 ms
 *   - Domain ops p95      < 1 ms
 *   - Auth login p95      < 100 ms
 *   - Outbox lag p95      < 5000 ms
 *   - WebSocket p99       < 1000 ms (in-memory: well under 10 ms)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const RESULTS_DIR = join(__dirname, 'results');

const NS_PER_MS = 1_000_000n;
const NS_PER_SEC = 1_000_000_000n;

/**
 * Default warmup/iteration counts when the bench definition omits them.
 */
export const DEFAULT_WARMUP = 100;
export const DEFAULT_ITERATIONS = 1000;

/* ---------------- core measurement primitives ---------------- */

/**
 * @typedef {Object} BenchResult
 * @property {string} name
 * @property {number} samples
 * @property {number} mean        microseconds
 * @property {number} p50         microseconds
 * @property {number} p95         microseconds
 * @property {number} p99         microseconds
 * @property {number} min         microseconds
 * @property {number} max         microseconds
 * @property {number} opsPerSec
 * @property {number} totalMs     wall-clock wall time of measured loop (ms)
 */

/**
 * Run a single bench. Each iteration's elapsed nanoseconds are captured
 * individually; warmup iterations are discarded.
 *
 * @param {{
 *   name: string,
 *   warmup?: number,
 *   iterations?: number,
 *   setup?: () => Promise<any>|any,
 *   fn: (ctx?: any, i?: number) => Promise<any>|any,
 *   teardown?: (ctx?: any) => Promise<any>|any,
 * }} def
 * @returns {Promise<BenchResult>}
 */
export async function bench(def) {
  if (!def || typeof def !== 'object') {
    throw new TypeError('bench: definition object required');
  }
  if (typeof def.name !== 'string' || !def.name) {
    throw new TypeError('bench: name (string) required');
  }
  if (typeof def.fn !== 'function') {
    throw new TypeError(`bench[${def.name}]: fn (function) required`);
  }

  const warmup = Number.isFinite(def.warmup) ? def.warmup : DEFAULT_WARMUP;
  const iterations = Number.isFinite(def.iterations) ? def.iterations : DEFAULT_ITERATIONS;

  const ctx = def.setup ? await def.setup() : undefined;

  // Warmup phase — discard timings.
  for (let i = 0; i < warmup; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await def.fn(ctx, i);
  }

  const samples = new Array(iterations);
  const loopStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) {
    const t0 = process.hrtime.bigint();
    // eslint-disable-next-line no-await-in-loop
    await def.fn(ctx, i);
    const t1 = process.hrtime.bigint();
    samples[i] = Number(t1 - t0); // nanoseconds
  }
  const loopEnd = process.hrtime.bigint();
  const totalNs = Number(loopEnd - loopStart);

  if (def.teardown) {
    try { await def.teardown(ctx); } catch { /* ignore */ }
  }

  return summarise(def.name, samples, totalNs);
}

/**
 * Build a `BenchResult` from raw nanosecond samples.
 * @param {string} name
 * @param {number[]} samplesNs
 * @param {number} [totalNs] wall-clock of measured loop (ns)
 * @returns {BenchResult}
 */
export function summarise(name, samplesNs, totalNs) {
  if (!Array.isArray(samplesNs) || samplesNs.length === 0) {
    return {
      name,
      samples: 0,
      mean: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0,
      opsPerSec: 0, totalMs: 0,
    };
  }
  const sorted = samplesNs.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, n) => acc + n, 0);
  const mean = sum / sorted.length;
  const wall = totalNs ?? sum;
  const seconds = wall / 1e9;
  return {
    name,
    samples: sorted.length,
    mean: nsToUs(mean),
    p50: nsToUs(percentile(sorted, 0.50)),
    p95: nsToUs(percentile(sorted, 0.95)),
    p99: nsToUs(percentile(sorted, 0.99)),
    min: nsToUs(sorted[0]),
    max: nsToUs(sorted[sorted.length - 1]),
    opsPerSec: seconds > 0 ? sorted.length / seconds : 0,
    totalMs: wall / 1e6,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

function nsToUs(ns) {
  return Math.round(ns / 10) / 100; // microseconds with 2-decimal precision
}

/* ---------------- suite orchestration ---------------- */

/**
 * Run an array of bench definitions sequentially. Definitions can be either
 * a {@link BenchDefinition} or an already-shaped {@link BenchResult} (passed
 * through). Suites are tagged on every contained result via `result.suite`.
 *
 * @param {{ name: string, benches: Array<object> }} def
 * @returns {Promise<Array<BenchResult & {suite: string}>>}
 */
export async function suite(def) {
  if (!def || !Array.isArray(def.benches)) {
    throw new TypeError('suite: benches array required');
  }
  const out = [];
  for (const b of def.benches) {
    if (!b) continue;
    let result;
    if (typeof b.fn === 'function') {
      // eslint-disable-next-line no-await-in-loop
      result = await bench(b);
    } else if (typeof b.name === 'string' && Number.isFinite(b.mean)) {
      result = b;
    } else {
      continue;
    }
    out.push({ ...result, suite: def.name });
  }
  return out;
}

/* ---------------- reporting ---------------- */

/**
 * Pretty-print or persist a result set.
 *
 * Modes:
 *   - `'console'` (default) prints a fixed-width table to stdout.
 *   - `'json'` writes `<RESULTS_DIR>/<timestamp>.json` AND
 *     `<RESULTS_DIR>/latest.json`.
 *
 * `opts.file` overrides the timestamped filename.
 *
 * @param {BenchResult[]} results
 * @param {{ format?: 'console'|'json'|'both', file?: string, meta?: object }} [opts]
 */
export async function report(results, opts = {}) {
  const format = opts.format ?? 'console';
  if (!Array.isArray(results)) {
    throw new TypeError('report: results array required');
  }

  if (format === 'console' || format === 'both') {
    printTable(results);
  }

  if (format === 'json' || format === 'both') {
    await mkdir(RESULTS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fname = opts.file ?? `${stamp}.json`;
    const doc = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      meta: opts.meta ?? null,
      results,
    };
    const json = JSON.stringify(doc, null, 2);
    await writeFile(join(RESULTS_DIR, fname), json, 'utf8');
    await writeFile(join(RESULTS_DIR, 'latest.json'), json, 'utf8');
  }
  return results;
}

function printTable(results) {
  // Columns: name | mean | p50 | p95 | p99 | ops/sec | samples
  const cols = [
    { key: 'name', label: 'Name', align: 'left', width: 38 },
    { key: 'mean', label: 'mean(ms)', align: 'right', width: 10, fmt: usToMs },
    { key: 'p50', label: 'p50(ms)', align: 'right', width: 9, fmt: usToMs },
    { key: 'p95', label: 'p95(ms)', align: 'right', width: 9, fmt: usToMs },
    { key: 'p99', label: 'p99(ms)', align: 'right', width: 9, fmt: usToMs },
    { key: 'opsPerSec', label: 'ops/sec', align: 'right', width: 10, fmt: (v) => v.toFixed(1) },
    { key: 'samples', label: 'samples', align: 'right', width: 8, fmt: (v) => String(v) },
  ];
  const sep = `+${cols.map((c) => '-'.repeat(c.width + 2)).join('+')}+`;
  const header = `|${cols.map((c) => ` ${pad(c.label, c.width, c.align)} `).join('|')}|`;
  // eslint-disable-next-line no-console
  console.log(sep);
  // eslint-disable-next-line no-console
  console.log(header);
  // eslint-disable-next-line no-console
  console.log(sep);
  for (const r of results) {
    const row = cols.map((c) => {
      const raw = r[c.key];
      const txt = c.fmt ? c.fmt(raw) : String(raw ?? '');
      return ` ${pad(txt, c.width, c.align)} `;
    });
    // eslint-disable-next-line no-console
    console.log(`|${row.join('|')}|`);
  }
  // eslint-disable-next-line no-console
  console.log(sep);
}

function usToMs(us) {
  return (Number(us) / 1000).toFixed(3);
}

function pad(s, width, align) {
  const str = String(s);
  if (str.length >= width) return str.slice(0, width);
  const pad = ' '.repeat(width - str.length);
  return align === 'right' ? pad + str : str + pad;
}

/* ---------------- SLO comparison helpers ---------------- */

/**
 * SLO budgets in microseconds. Indexed by the canonical scenario name.
 * The map is intentionally explicit so the markdown writer can be deterministic.
 *
 * Fields:
 *   - metric: which percentile field on a `BenchResult` to compare
 *   - budget: maximum allowed value in microseconds
 *   - human:  pretty form for the report column
 */
export const SLO_BUDGETS = Object.freeze({
  // Workflow reads — ADR 0021: p95 < 250 ms.
  'workflow.detail':            { metric: 'p95', budget: 250_000, human: 'p95 < 250 ms' },
  // Workflow write hot paths — same envelope as reads in absence of a stricter SLO.
  'workflow.create':            { metric: 'p95', budget: 250_000, human: 'p95 < 250 ms' },
  'workflow.execute':           { metric: 'p95', budget: 250_000, human: 'p95 < 250 ms' },
  'workflow.respond':           { metric: 'p95', budget: 250_000, human: 'p95 < 250 ms' },
  'workflow.lifecycle':         { metric: 'p95', budget: 750_000, human: 'p95 < 750 ms' },
  // Auth — bcrypt is the cost; ADR target login p95 < 100 ms.
  'auth.login':                 { metric: 'p95', budget: 100_000, human: 'p95 < 100 ms' },
  'auth.register':              { metric: 'p95', budget: 250_000, human: 'p95 < 250 ms' },
  'auth.refresh':               { metric: 'p95', budget: 50_000,  human: 'p95 < 50 ms' },
  'auth.middleware':            { metric: 'p95', budget: 10_000,  human: 'p95 < 10 ms' },
  // Repository hot paths — domain ops envelope; target is "fast".
  'workflow_repo.save':         { metric: 'p95', budget: 5_000,   human: 'p95 < 5 ms' },
  'workflow_repo.findById':     { metric: 'p95', budget: 5_000,   human: 'p95 < 5 ms' },
  'human_response_repo.save':   { metric: 'p95', budget: 5_000,   human: 'p95 < 5 ms' },
  'human_response_repo.findByIdempotencyKey':
                                { metric: 'p95', budget: 5_000,   human: 'p95 < 5 ms' },
  'outbox.enqueue':             { metric: 'p95', budget: 1_000,   human: 'p95 < 1 ms' },
  'outbox.pickBatch(100)':      { metric: 'p95', budget: 5_000,   human: 'p95 < 5 ms' },
  // Outbox publish drain — ADR 0021: outbox lag p95 < 5 s.
  'outbox.publish[100]':        { metric: 'p95', budget: 5_000_000, human: 'drain p95 < 5 s' },
  'outbox.publish[500]':        { metric: 'p95', budget: 5_000_000, human: 'drain p95 < 5 s' },
  'outbox.publish[1000]':       { metric: 'p95', budget: 5_000_000, human: 'drain p95 < 5 s' },
  // WebSocket fanout — ADR 0021: p99 < 1 s; in-memory should be far under.
  'websocket.broadcast[10]':    { metric: 'p99', budget: 1_000_000, human: 'p99 < 1 s' },
  'websocket.broadcast[100]':   { metric: 'p99', budget: 1_000_000, human: 'p99 < 1 s' },
  'websocket.broadcast[500]':   { metric: 'p99', budget: 1_000_000, human: 'p99 < 1 s' },
  // Pure domain ops — target p95 < 1 ms.
  'workflow.next_action':                { metric: 'p95', budget: 1_000, human: 'p95 < 1 ms' },
  'workflow.apply_human_response':       { metric: 'p95', budget: 1_000, human: 'p95 < 1 ms' },
  'response_validation.validate':        { metric: 'p95', budget: 1_000, human: 'p95 < 1 ms' },
  'authorisation.is_authorised':         { metric: 'p95', budget: 1_000, human: 'p95 < 1 ms' },
});

/**
 * Compare a result against its SLO budget. Returns one of:
 *   { status: 'PASS', slo: '...', metric, value }
 *   { status: 'FAIL', slo: '...', metric, value, overBy }
 *   { status: 'N/A', slo: null }
 */
export function compareToSlo(result) {
  const slo = SLO_BUDGETS[result.name];
  if (!slo) return { status: 'N/A', slo: null };
  const value = result[slo.metric];
  if (typeof value !== 'number') return { status: 'N/A', slo: null };
  const ok = value <= slo.budget;
  return ok
    ? { status: 'PASS', slo: slo.human, metric: slo.metric, value }
    : { status: 'FAIL', slo: slo.human, metric: slo.metric, value, overBy: value - slo.budget };
}

/* ---------------- self-test convenience ---------------- */

/**
 * Helper a scenario file can call when invoked directly via
 * `node tests/benchmarks/scenarios/foo.bench.js`. Runs the suite and prints
 * a console table; if `BENCH_JSON=1` is set in the env, also writes JSON.
 */
export async function runStandalone(suiteName, benchesFactory) {
  const benches = await benchesFactory();
  const results = await suite({ name: suiteName, benches });
  const wantJson = process.env.BENCH_JSON === '1';
  await report(results, { format: wantJson ? 'both' : 'console' });
  return results;
}
