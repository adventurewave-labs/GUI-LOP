// @ts-check
/**
 * main.js — composition root for the v1 (DDD) HTTP server.
 *
 * Wires the six bounded contexts merged in `src/backend/contexts/` plus
 * the shared kernel (`src/backend/shared-kernel/`) into a single Express
 * app and HTTP server. Picks Postgres-backed adapters when `DATABASE_URL`
 * is set, else uses in-memory adapters across the board so the server
 * boots without any external infrastructure in dev/CI.
 *
 * Public surface:
 *   - `bootstrap(env?)` returns `{ app, httpServer, shutdown }`.
 *   - `bootstrap(...).shutdown()` closes the pool, the redis client, the
 *     WebSocket server, and the outbox consumer cleanly.
 *
 * The entry point `index.js` calls `bootstrap()` and listens on
 * `config.PORT` with graceful SIGTERM/SIGINT handling.
 */

import { createPgPool, pgPoolStats } from '../shared-kernel/infrastructure/pg-pool.js';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { loadConfig } from './config.js';
import { systemClock } from '../shared-kernel/infrastructure/system-clock.js';
import { uuidGenerator } from '../shared-kernel/infrastructure/uuid-generator.js';
import { createPgOutboxRepository } from '../shared-kernel/infrastructure/pg-outbox-repository.js';
import { InMemoryOutbox } from '../shared-kernel/infrastructure/inmemory-outbox.js';
import { createLogger } from '../shared-kernel/infrastructure/logger.js';

import { wireIdentityAndAccess } from './wire-identity-and-access.js';
import { disposeBcryptWorkerPool } from '../contexts/identity-and-access/infrastructure/crypto/bcrypt-password-hasher.js';
import { wireWorkflowOrchestration } from './wire-workflow-orchestration.js';
import { wireUIGeneration } from './wire-ui-generation.js';
import { wireHumanInteraction } from './wire-human-interaction.js';
import { wireNotification } from './wire-notification.js';
import { wireAuditAndAnalytics } from './wire-audit-and-analytics.js';
import { createMetrics } from './metrics.js';
import { problemDetailsMiddleware } from '../shared-kernel/infrastructure/problem-details.js';
import { createRateLimiterFactory } from '../shared-kernel/infrastructure/rate-limiters.js';
import { traceContextMiddleware } from '../shared-kernel/infrastructure/trace-context.js';
import { makeWsPrincipalResolver } from '../contexts/identity-and-access/interfaces/websocket/ws-principal-resolver.js';
import {
  requestIdMiddleware,
  accessLogMiddleware,
  parseTrustProxy,
  jsonErrorHandler,
  applyServerTimeouts,
  probeWithTimeout,
} from './http-hardening.js';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Per-dependency deadline for readiness probes. */
const PROBE_TIMEOUT_MS = 800;

/* -------------------- bootstrap -------------------- */

/**
 * Build the v1 server.
 * @param {Record<string,string|undefined>} [envOverride]
 * @returns {Promise<{app: import('express').Express, httpServer: import('http').Server, shutdown: (opts?: { drainDelayMs?: number, inFlightTimeoutMs?: number }) => Promise<void>, config: import('../shared-kernel/config/config-loader.js').AppConfig, ctx: any}>}
 */
export async function bootstrap(envOverride) {
  const config = loadConfig(envOverride ?? process.env);
  const logger = createLogger({ level: config.LOG_LEVEL });

  const clock = systemClock;
  const idGen = uuidGenerator;

  /* -------- infrastructure: Postgres + Redis (optional) -------- */
  let pool = null;
  let redis = null;
  let outbox;

  if (config.DATABASE_URL) {
    const pgModule = await import('pg');
    const Pool = pgModule.default?.Pool ?? pgModule.Pool;
    pool = createPgPool(Pool, config, logger);
    outbox = createPgOutboxRepository(pool);
    logger.info('shared-kernel: postgres pool initialised');
  } else {
    outbox = new InMemoryOutbox();
    logger.warn('DATABASE_URL not set; using in-memory adapters');
  }

  if (config.REDIS_URL) {
    const redisModule = await import('ioredis');
    const Redis = /** @type {any} */ (redisModule.default ?? redisModule);
    redis = new Redis(config.REDIS_URL, { lazyConnect: true });
    try {
      await redis.connect();
      logger.info('shared-kernel: redis client connected');
    } catch (err) {
      logger.warn(`redis connect failed (${err.message}); continuing without redis`);
      try { redis.disconnect(); } catch { /* ignore */ }
      redis = null;
    }
  } else {
    logger.warn('REDIS_URL not set; falling back to in-memory adapters');
  }

  /* -------- bounded contexts -------- */

  // ADR 0015: one limiter factory; Redis-backed (global across replicas)
  // whenever Redis is connected.
  const rateLimiter = await createRateLimiterFactory({ redis, logger });
  logger.info(`rate limiting: ${rateLimiter.backend} store`);

  const identity = wireIdentityAndAccess({ pool, redis, clock, idGen, config, logger, rateLimiter });

  /* -------- metrics (created early so adapters can report into it) -------- */
  let wsHandle = null;
  let uiRef = null;
  const metrics = createMetrics({
    outbox,
    dbPool: () => pgPoolStats(pool),
    wsConnectionCount: () => wsHandle?.wss?.clients?.size ?? 0,
    aiProvider: () => uiRef?.aiProvider ?? null,
    logger,
    defaultMetrics: config.METRICS_ENABLED,
  });

  const ui = wireUIGeneration({
    pool,
    clock,
    idGen,
    logger,
    config,
    onAITelemetry: metrics.onAITelemetry,
  });
  uiRef = ui;

  // Wire workflow without an advancer first; we'll fold that in for human-interaction.
  const workflow = await wireWorkflowOrchestration({
    pool,
    outbox,
    clock,
    idGen,
    identityAuthorisationService: identity.authorisationService,
    generateUIForStepCommand: ui.useCases.generateUIForStep,
    logger,
  });

  const humanInteraction = wireHumanInteraction({
    pool,
    clock,
    idGen,
    identityUserRepository: identity.repositories.userRepository,
    identityRoleRepository: identity.repositories.roleRepository,
    identityGrantsRepository: identity.repositories.grantsRepository,
    identityAuthorisationService: identity.authorisationService,
    workflowAdvanceUseCase: workflow.useCases.advanceWorkflow,
    workflowGetDetailQuery: workflow.useCases.getDetail,
    logger,
  });

  const notification = wireNotification({
    pool,
    redis,
    outbox,
    clock,
    idGen,
    logger,
    config,
  });

  const audit = wireAuditAndAnalytics({
    pool,
    clock,
    idGen,
    objectStorage: ui.objectStorage,
    logger,
  });

  /* -------- workflow domain events -> outbox + handlers -------- */

  // The Pg* aggregate repositories enqueue events transactionally inside
  // their `save()`. The in-memory repos can't do that, so when running
  // without Postgres we wire each in-memory repo to push events directly
  // through Notification's DeliverEvent use case. That fans out to the
  // WebSocket broadcaster (and the in-process event publisher) so:
  //   - the human-interaction handler still reacts to
  //     `workflow.human_input_required`;
  //   - WebSocket subscribers still receive `workflow.*` /
  //     `human_response.*` envelopes end-to-end without depending on
  //     the OutboxConsumer's polling cadence.
  // Recursion guard: nothing inside DeliverEvent calls back into a
  // repository save, so the sink cannot re-enter itself.
  function forwardWorkflowEvents() {
    if (pool) return; // Pg adapters already enqueue; nothing to do.
    const deliver = notification.useCases.deliverEvent;
    const onWorkflowHumanInputRequired =
      humanInteraction.eventHandlers?.onWorkflowHumanInputRequired ?? null;
    const onWorkflowCancelled =
      humanInteraction.eventHandlers?.onWorkflowCancelled ?? null;
    const sink = {
      async append(events) {
        if (!events || events.length === 0) return;
        for (const ev of events) {
          const json = typeof ev?.toJSON === 'function' ? ev.toJSON() : ev;
          // Shape the envelope the OutboxConsumer would build, so the
          // DeliverEvent contract (event.eventId/type/payload) matches.
          const event = {
            eventId: json.eventId ?? null,
            type: json.eventType ?? json.type ?? null,
            eventType: json.eventType ?? json.type ?? null,
            version: json.eventVersion ?? json.version ?? 1,
            aggregateId: json.aggregateId ?? null,
            aggregateType: json.aggregateType ?? null,
            payload: json.payload ?? {},
            occurredAt: json.occurredAt ?? new Date().toISOString(),
            correlationId: json.correlationId ?? null,
          };
          // 1. Cross-context handler: human-interaction projection.
          if (event.type === 'workflow_orchestration.workflow.human_input_required'
              && onWorkflowHumanInputRequired) {
            try { await onWorkflowHumanInputRequired.handle(event); }
            catch (err) { logger.error(`onWorkflowHumanInputRequired failed: ${err?.message ?? err}`); }
          }
          if (event.type === 'workflow_orchestration.workflow.cancelled'
              && onWorkflowCancelled?.handle) {
            try { await onWorkflowCancelled.handle(event); }
            catch (err) { logger.error(`onWorkflowCancelled failed: ${err?.message ?? err}`); }
          }
          // 2. Notification fan-out: WebSocket broadcaster + transports.
          try { await deliver.execute(event); }
          catch (err) { logger.error(`deliverEvent failed: ${err?.message ?? err}`); }
        }
      },
    };
    // Only the in-memory adapters accept a sink; Pg adapters write the outbox.
    /** @type {any} */
    const wfRepo = workflow.repositories.workflows;
    /** @type {any} */
    const respRepo = humanInteraction.repositories.responseRepository;
    if (typeof wfRepo.setEventSink === 'function') wfRepo.setEventSink(sink);
    if (typeof respRepo.setEventSink === 'function') respRepo.setEventSink(sink);
    // Templates emit events via the cached decorator's delegate; the
    // delegate is the in-memory repo when there's no pool.
    const tmplDelegate = workflow.repositories.templates?._delegate ?? workflow.repositories.templates;
    if (tmplDelegate && typeof tmplDelegate.setEventSink === 'function') {
      tmplDelegate.setEventSink(sink);
    }
  }
  forwardWorkflowEvents();

  /* -------- start outbox consumer + deadline watcher -------- */

  notification.startOutboxConsumer({ intervalMs: 250 });
  const deadlineWatcher = humanInteraction.startWatcher({ intervalMs: 30_000 });

  /* -------- express app -------- */

  /** Flipped by shutdown(); read by /readyz and the drain middleware. */
  let draining = false;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(config.TRUST_PROXY));
  // First, so every response — including body-parser errors — carries an id.
  app.use(requestIdMiddleware());
  // RFC 9457: every JSON error response becomes application/problem+json
  // (legacy envelope fields preserved as extension members).
  app.use(problemDetailsMiddleware());
  app.use(traceContextMiddleware());
  app.use(accessLogMiddleware({ logger }));
  if (config.METRICS_ENABLED) app.use(metrics.httpMiddleware());
  // While draining, tell keep-alive clients to reconnect elsewhere.
  app.use((_req, res, next) => {
    if (draining) res.set('Connection', 'close');
    next();
  });
  // JSON-only API: lock down everything a browser could render.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: true,
      // Let browser clients read correlation headers for bug reports / RUM,
      // the ETag for conditional writes (If-Match), and the idempotency /
      // rate-limit signals they are expected to act on.
      exposedHeaders: ['X-Request-Id', 'traceresponse', 'ETag', 'Idempotent-Replayed', 'Retry-After', 'RateLimit', 'RateLimit-Policy'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // General API budget per client (fail-open: availability over strictness
  // for ordinary traffic; auth routes add their own fail-closed limits).
  app.use(
    '/api/v1',
    rateLimiter('api', {
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX,
      message: 'Too many requests',
    }),
  );

  // Identity & Access (public + protected).
  app.use('/api/v1/auth', identity.router);
  // Self-service API key management (auth required) and admin user routes.
  app.use('/api/v1/auth/api-keys', identity.apiKeyRouter);
  app.use('/api/v1/admin', identity.adminRouter);

  // Protected routes — every following route requires an authenticated principal.
  // Express middlewares are mounted by router, so protect at mount time.
  app.use('/api/v1/workflows', identity.authMiddleware, workflow.v1Router);
  app.use('/api/v1', identity.authMiddleware, humanInteraction.router);
  app.use('/api/v1/ui', identity.authMiddleware, ui.router);
  app.use('/api/v1', identity.authMiddleware, audit.routers.analytics);
  app.use('/api/v1', identity.authMiddleware, audit.routers.audit);
  app.use('/api/v1', identity.authMiddleware, audit.routers.dashboards);
  app.use('/api/v1', identity.authMiddleware, notification.router);

  // Kubernetes-style probes. Liveness never touches dependencies (a DB blip
  // must not restart every pod); readiness fails fast while draining or
  // when a configured dependency is unreachable.
  if (config.METRICS_ENABLED) {
    app.get(
      '/metrics',
      metrics.handler({
        token: config.METRICS_TOKEN,
        failClosed: config.NODE_ENV === 'production',
      }),
    );
  }

  app.get('/livez', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });
  app.get('/readyz', async (_req, res) => {
    const checks = {};
    if (pool) {
      const r = await probeWithTimeout(() => pool.query('SELECT 1'), PROBE_TIMEOUT_MS);
      checks.db = r.ok ? 'ok' : `error:${r.error}`;
    }
    if (redis) {
      const r = await probeWithTimeout(() => redis.ping(), PROBE_TIMEOUT_MS);
      checks.redis = r.ok && r.value === 'PONG' ? 'ok' : `error:${r.ok ? 'unexpected' : r.error}`;
    }
    const ready = !draining && Object.values(checks).every((v) => v === 'ok');
    res
      .status(ready ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json({ status: ready ? 'ready' : draining ? 'draining' : 'not_ready', checks });
  });

  // Liveness + dependency-status probe (ADR 0021 — Observability).
  app.get('/health', async (_req, res) => {
    let dbStatus = pool ? 'unknown' : 'disabled';
    let dbConnected = false;
    if (pool) {
      try {
        await pool.query('SELECT 1');
        dbStatus = 'ok';
        dbConnected = true;
      } catch (err) {
        dbStatus = `error:${err.code ?? err.message ?? 'unknown'}`;
      }
    }
    let redisStatus = redis ? 'unknown' : 'disabled';
    let redisConnected = false;
    if (redis) {
      try {
        const pong = await redis.ping();
        redisStatus = pong === 'PONG' ? 'ok' : 'unexpected';
        redisConnected = pong === 'PONG';
      } catch (err) {
        redisStatus = `error:${err.message ?? 'unknown'}`;
      }
    }

    // Outbox lag: oldest pending event age + total pending count. We
    // surface -1 on lookup failure so monitoring can alert distinctly
    // from "0 lag, all caught up".
    let lagMs = 0;
    let pendingCount = 0;
    try {
      lagMs = await outbox.getOldestPendingAge(new Date());
    } catch (err) {
      logger.warn(`outbox.getOldestPendingAge failed: ${err?.message ?? err}`);
      lagMs = -1;
    }
    try {
      pendingCount = await outbox.getPendingCount();
    } catch (err) {
      logger.warn(`outbox.getPendingCount failed: ${err?.message ?? err}`);
      pendingCount = -1;
    }

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'GUI-LOP v1 (DDD) is running',
      subsystems: {
        db: { status: dbStatus, connected: dbConnected },
        redis: { status: redisStatus, connected: redisConnected },
        outbox: { lag_ms: lagMs, pending_count: pendingCount },
      },
    });
  });

  // Generic 404 + error handler so unhandled routes return JSON not HTML.
  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path, request_id: req.id });
  });
  app.use(jsonErrorHandler({ logger }));

  /* -------- HTTP server + WebSocket -------- */

  const httpServer = applyServerTimeouts(http.createServer(app), config);
  if (config.WS_ALLOW_HEADER_AUTH) {
    logger.warn('WS_ALLOW_HEADER_AUTH=true: WebSocket upgrades accept unauthenticated X-User-Id (dev only)');
  }
  wsHandle = await notification.attachWebSocket(httpServer, {
    principalFromUpgrade: makeWsPrincipalResolver({
      tokenIssuer: identity.tokenIssuer,
      tokenBlacklist: identity.tokenBlacklist,
      authenticateWithApiKey: identity.useCases?.authenticateWithApiKey,
      allowHeaderAuth: config.WS_ALLOW_HEADER_AUTH,
      logger,
    }),
  });

  /* -------- shutdown -------- */

  /**
   * Graceful shutdown, ordered for zero-dropped-request rollouts:
   *
   *   1. drain     — /readyz → 503 and responses carry `Connection: close`,
   *                  but we KEEP SERVING for `drainDelayMs` so the LB /
   *                  kube-proxy stops routing here before we stop accepting.
   *   2. stop bg   — outbox consumer + deadline watcher (no new side effects).
   *   3. close ws  — 1001 Going Away → clients reconnect to a healthy pod.
   *   4. close http— stop accepting, drop idle keep-alives, let in-flight
   *                  requests finish; force-close stragglers at the deadline.
   *   5. release   — redis, pg pool, bcrypt workers.
   *
   * Idempotent: concurrent callers share the same in-flight promise.
   *
   * @param {{ drainDelayMs?: number, inFlightTimeoutMs?: number }} [opts]
   *   Defaults are 0 / 5000 so tests and programmatic callers stay fast;
   *   `index.js` passes the production values from config.
   */
  let shutdownPromise = null;
  function shutdown(opts = {}) {
    if (!shutdownPromise) shutdownPromise = runShutdown(opts);
    return shutdownPromise;
  }

  async function runShutdown({ drainDelayMs = 0, inFlightTimeoutMs = 5000 } = {}) {
    draining = true;
    logger.info('shutdown: draining', { drain_delay_ms: drainDelayMs });
    if (drainDelayMs > 0) await sleep(drainDelayMs);

    notification.stopOutboxConsumer();
    if (deadlineWatcher && typeof deadlineWatcher.stop === 'function') {
      try { await deadlineWatcher.stop(); } catch { /* ignore */ }
    }

    if (wsHandle && typeof wsHandle.close === 'function') {
      try { await wsHandle.close({ code: 1001, reason: 'server shutting down' }); } catch { /* ignore */ }
    }

    await new Promise(/** @param {(v?: unknown) => void} resolve */ (resolve) => {
      if (!httpServer.listening) {
        resolve();
        return;
      }
      const force = setTimeout(() => {
        logger.warn('shutdown: in-flight deadline reached; force-closing connections');
        httpServer.closeAllConnections?.();
      }, inFlightTimeoutMs);
      force.unref?.();
      // Sockets become idle as in-flight responses complete; sweep them so
      // close() resolves as soon as the last request finishes rather than
      // waiting out HTTP_KEEPALIVE_TIMEOUT_MS on pooled LB connections.
      const sweep = setInterval(() => httpServer.closeIdleConnections?.(), 50);
      sweep.unref?.();
      httpServer.close(() => {
        clearTimeout(force);
        clearInterval(sweep);
        resolve();
      });
      httpServer.closeIdleConnections?.();
    });

    if (redis) {
      try { await redis.quit(); } catch { /* ignore */ }
    }
    if (pool && typeof pool.end === 'function') {
      try { await pool.end(); } catch { /* ignore */ }
    }
    // Tear down the bcrypt worker-thread pool (if it was lazily spawned).
    try { await disposeBcryptWorkerPool(); } catch { /* ignore */ }
    logger.info('shutdown: complete');
  }

  return {
    app,
    httpServer,
    shutdown,
    config,
    ctx: {
      logger,
      metrics,
      pool,
      redis,
      outbox,
      identity,
      workflow,
      humanInteraction,
      notification,
      audit,
      ui,
    },
  };
}
