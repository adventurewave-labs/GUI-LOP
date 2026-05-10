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

import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import cors from 'cors';

import { loadConfig } from './config.js';
import { systemClock } from '../shared-kernel/infrastructure/system-clock.js';
import { uuidGenerator } from '../shared-kernel/infrastructure/uuid-generator.js';
import { createPgOutboxRepository } from '../shared-kernel/infrastructure/pg-outbox-repository.js';
import { InMemoryOutbox } from '../shared-kernel/infrastructure/inmemory-outbox.js';
import { createLogger } from '../shared-kernel/infrastructure/logger.js';

import { wireIdentityAndAccess } from './wire-identity-and-access.js';
import { wireWorkflowOrchestration } from './wire-workflow-orchestration.js';
import { wireUIGeneration } from './wire-ui-generation.js';
import { wireHumanInteraction } from './wire-human-interaction.js';
import { wireNotification } from './wire-notification.js';
import { wireAuditAndAnalytics } from './wire-audit-and-analytics.js';

/* -------------------- middleware helpers -------------------- */

/** Attach a stable request id so logs and downstream services can correlate. */
function requestIdMiddleware() {
  return (req, _res, next) => {
    req.id = req.header('X-Request-Id') ?? randomUUID();
    next();
  };
}

/* -------------------- bootstrap -------------------- */

/**
 * Build the v1 server.
 * @param {Record<string,string|undefined>} [envOverride]
 * @returns {Promise<{app: import('express').Express, httpServer: import('http').Server, shutdown: () => Promise<void>, ctx: object}>}
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
    pool = new Pool({ connectionString: config.DATABASE_URL });
    outbox = createPgOutboxRepository(pool);
    logger.info('shared-kernel: postgres pool initialised');
  } else {
    outbox = new InMemoryOutbox();
    logger.warn('DATABASE_URL not set; using in-memory adapters');
  }

  if (config.REDIS_URL) {
    const redisModule = await import('ioredis');
    const Redis = redisModule.default ?? redisModule;
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

  const identity = wireIdentityAndAccess({ pool, redis, clock, idGen, config, logger });

  const ui = wireUIGeneration({ pool, clock, idGen, logger });

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
  });

  const audit = wireAuditAndAnalytics({
    pool,
    clock,
    idGen,
    objectStorage: ui.objectStorage,
    logger,
  });

  /* -------- workflow domain events -> outbox + handlers -------- */

  // The PgWorkflowRepository writes events transactionally; the in-memory
  // workflow repository doesn't. Forward any unsaved events from the
  // workflow event sink (created by tests/dev mode) into the shared outbox
  // so the OutboxConsumer can fan them out and the human-interaction
  // handler can react to `workflow.human_input_required`.
  function forwardWorkflowEvents() {
    // Subscribe to the in-process publisher used by all use cases for dev mode.
    // The repositories already enqueue to `outbox`; this is a defensive hook
    // for any future event sources we add.
  }
  forwardWorkflowEvents();

  /* -------- start outbox consumer + deadline watcher -------- */

  notification.startOutboxConsumer({ intervalMs: 250 });
  const deadlineWatcher = humanInteraction.startWatcher({ intervalMs: 30_000 });

  /* -------- express app -------- */

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware());

  // Identity & Access (public + protected).
  app.use('/api/v1/auth', identity.router);

  // Protected routes — every following route requires an authenticated principal.
  // Express middlewares are mounted by router, so protect at mount time.
  app.use('/api/v1/workflows', identity.authMiddleware, workflow.v1Router);
  app.use('/api/v1', identity.authMiddleware, humanInteraction.router);
  app.use('/api/v1/ui', identity.authMiddleware, ui.router);
  app.use('/api/v1', identity.authMiddleware, audit.routers.analytics);
  app.use('/api/v1', identity.authMiddleware, audit.routers.audit);
  app.use('/api/v1', identity.authMiddleware, audit.routers.dashboards);
  app.use('/api/v1', identity.authMiddleware, notification.router);

  // Legacy alias for the simple-server `/api/workflows/*` shape.
  app.use('/api/workflows', identity.authMiddleware, workflow.legacyRouter);

  // Liveness + dependency-status probe.
  app.get('/health', async (_req, res) => {
    let dbStatus = pool ? 'unknown' : 'disabled';
    if (pool) {
      try {
        await pool.query('SELECT 1');
        dbStatus = 'ok';
      } catch (err) {
        dbStatus = `error:${err.code ?? err.message ?? 'unknown'}`;
      }
    }
    let redisStatus = redis ? 'unknown' : 'disabled';
    if (redis) {
      try {
        const pong = await redis.ping();
        redisStatus = pong === 'PONG' ? 'ok' : 'unexpected';
      } catch (err) {
        redisStatus = `error:${err.message ?? 'unknown'}`;
      }
    }
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'GUI-LOP v1 (DDD) is running',
      subsystems: {
        db: dbStatus,
        redis: redisStatus,
        outbox_lag: 'unknown',
      },
    });
  });

  // Generic 404 + error handler so unhandled routes return JSON not HTML.
  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path });
  });
  app.use((err, _req, res, _next) => {
    logger.error(`unhandled request error: ${err?.message ?? err}`);
    res.status(500).json({ error: 'internal_error', message: 'Unexpected error' });
  });

  /* -------- HTTP server + WebSocket -------- */

  const httpServer = http.createServer(app);
  const wsHandle = await notification.attachWebSocket(httpServer, {
    principalFromUpgrade: async (req) => {
      // Trust the legacy header in dev; production wires a JWT verifier.
      const sub = req.headers?.['x-user-id'] ?? null;
      return sub ? { id: sub } : null;
    },
  });

  /* -------- shutdown -------- */

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    notification.stopOutboxConsumer();
    if (deadlineWatcher && typeof deadlineWatcher.stop === 'function') {
      await deadlineWatcher.stop();
    }
    if (wsHandle && typeof wsHandle.close === 'function') {
      try { wsHandle.close(); } catch { /* ignore */ }
    }
    await new Promise((resolve) => httpServer.close(() => resolve()));
    if (redis) {
      try { await redis.quit(); } catch { /* ignore */ }
    }
    if (pool && typeof pool.end === 'function') {
      try { await pool.end(); } catch { /* ignore */ }
    }
  }

  return {
    app,
    httpServer,
    shutdown,
    config,
    ctx: {
      logger,
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
