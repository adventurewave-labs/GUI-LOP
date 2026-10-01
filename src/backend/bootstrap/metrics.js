/**
 * metrics — Prometheus instrumentation for the composition root.
 *
 * A registry per bootstrap() (not prom-client's global) so tests and
 * multiple in-process instances never collide on metric names.
 *
 * Exposed series (RED + saturation + domain health):
 *   http_request_duration_seconds{method,route,status_code}   histogram
 *   http_requests_in_flight                                   gauge
 *   outbox_pending_events / outbox_oldest_pending_age_seconds gauges (scrape-time)
 *   websocket_connections                                     gauge (scrape-time)
 *   ai_call_duration_seconds{provider,model,op,outcome}       histogram
 *   ai_tokens_total{provider,model,direction}                 counter
 *   ai_circuit_state{provider,state}                          gauge (1 = current)
 *   process_* / nodejs_* (event-loop lag, heap, GC)           defaults
 *
 * `route` is the Express route template (bounded cardinality); unmatched
 * paths collapse into `unmatched`.
 */

import { timingSafeEqual } from 'node:crypto';
import client from 'prom-client';
import { routeTemplate } from './http-hardening.js';
import { parseBearer } from '../shared-kernel/infrastructure/bearer.js';

const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const AI_BUCKETS = [0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30, 60];
const CIRCUIT_STATES = ['closed', 'open', 'half_open'];

/**
 * @param {object} deps
 * @param {{ getPendingCount(): Promise<number>, getOldestPendingAge(now: Date): Promise<number> }} [deps.outbox]
 * @param {() => number} [deps.wsConnectionCount]
 * @param {() => ({ name: string, circuitState: string } | null)} [deps.aiProvider]
 * @param {{ warn?: Function }} [deps.logger]
 * @param {boolean} [deps.defaultMetrics=true]
 */
export function createMetrics({ outbox, wsConnectionCount, aiProvider, logger, defaultMetrics = true } = {}) {
  const registry = new client.Registry();
  if (defaultMetrics) client.collectDefaultMetrics({ register: registry, eventLoopMonitoringPrecision: 20 });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by route template',
    labelNames: ['method', 'route', 'status_code'],
    buckets: HTTP_BUCKETS,
    registers: [registry],
  });
  const inFlight = new client.Gauge({
    name: 'http_requests_in_flight',
    help: 'HTTP requests currently being served',
    registers: [registry],
  });

  new client.Gauge({
    name: 'outbox_pending_events',
    help: 'Transactional outbox events not yet dispatched (-1 on lookup failure)',
    registers: [registry],
    async collect() {
      if (!outbox) return;
      try { this.set(await outbox.getPendingCount()); } catch { this.set(-1); }
    },
  });
  new client.Gauge({
    name: 'outbox_oldest_pending_age_seconds',
    help: 'Age of the oldest undispatched outbox event (-1 on lookup failure)',
    registers: [registry],
    async collect() {
      if (!outbox) return;
      try { this.set((await outbox.getOldestPendingAge(new Date())) / 1000); } catch { this.set(-1); }
    },
  });
  new client.Gauge({
    name: 'websocket_connections',
    help: 'Open WebSocket connections on this instance',
    registers: [registry],
    collect() {
      if (wsConnectionCount) this.set(Number(wsConnectionCount()) || 0);
    },
  });

  const aiDuration = new client.Histogram({
    name: 'ai_call_duration_seconds',
    help: 'AI provider call latency including retries',
    labelNames: ['provider', 'model', 'op', 'outcome'],
    buckets: AI_BUCKETS,
    registers: [registry],
  });
  const aiTokens = new client.Counter({
    name: 'ai_tokens_total',
    help: 'AI tokens consumed',
    labelNames: ['provider', 'model', 'direction'],
    registers: [registry],
  });
  new client.Gauge({
    name: 'ai_circuit_state',
    help: 'AI provider circuit breaker state (1 for the current state)',
    labelNames: ['provider', 'state'],
    registers: [registry],
    collect() {
      const p = aiProvider?.();
      if (!p) return;
      this.reset();
      for (const st of CIRCUIT_STATES) this.set({ provider: p.name, state: st }, p.circuitState === st ? 1 : 0);
    },
  });

  /** Express middleware recording RED metrics per request. */
  function httpMiddleware() {
    return (req, res, next) => {
      const end = httpDuration.startTimer();
      inFlight.inc();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        inFlight.dec();
        // Client aborts before headers: record as 499 (nginx convention).
        const status = !res.writableFinished && !res.headersSent ? 499 : res.statusCode;
        end({ method: req.method, route: routeTemplate(req), status_code: String(status) });
      };
      res.once('finish', finish);
      res.once('close', finish);
      next();
    };
  }

  /** Sink for BaseAIAdapter `onTelemetry`. */
  function onAITelemetry(rec) {
    const labels = { provider: rec.provider, model: rec.model || 'unknown' };
    aiDuration.observe(
      { ...labels, op: rec.op, outcome: rec.ok ? 'ok' : rec.errorName || 'error' },
      rec.durationMs / 1000,
    );
    const u = rec.tokenUsage;
    const input = Number(u?.inputTokens ?? u?.input_tokens ?? u?.prompt_tokens);
    const output = Number(u?.outputTokens ?? u?.output_tokens ?? u?.completion_tokens);
    if (Number.isFinite(input) && input > 0) aiTokens.inc({ ...labels, direction: 'input' }, input);
    if (Number.isFinite(output) && output > 0) aiTokens.inc({ ...labels, direction: 'output' }, output);
  }

  /**
   * GET /metrics handler. With `token` set, requires `Authorization: Bearer`.
   * Without a token, open unless `failClosed` (production) → 404.
   */
  function handler({ token, failClosed = false } = {}) {
    const expected = token ? Buffer.from(String(token)) : null;
    if (!expected && failClosed) {
      logger?.warn?.('METRICS_TOKEN unset in production; /metrics disabled');
    }
    return async (req, res) => {
      if (!expected) {
        if (failClosed) return res.status(404).json({ error: 'not_found', path: req.path });
      } else {
        const cred = parseBearer(req.get('authorization'));
        const given = cred ? Buffer.from(cred) : Buffer.alloc(0);
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
          res.set('WWW-Authenticate', 'Bearer');
          return res.status(401).json({ error: 'unauthorised' });
        }
      }
      try {
        res.set('Content-Type', registry.contentType).set('Cache-Control', 'no-store');
        res.send(await registry.metrics());
      } catch (err) {
        logger?.warn?.('metrics collection failed', { err });
        res.status(500).json({ error: 'metrics_unavailable' });
      }
    };
  }

  return { registry, httpMiddleware, onAITelemetry, handler };
}
