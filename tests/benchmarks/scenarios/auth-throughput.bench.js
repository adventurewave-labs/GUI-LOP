/**
 * auth-throughput.bench.js — measures the Identity & Access HTTP hot paths.
 *
 *   - auth.register     POST /api/v1/auth/register (fresh email per call)
 *   - auth.login        POST /api/v1/auth/login    (one pre-registered user)
 *   - auth.refresh      POST /api/v1/auth/refresh  (rotating refresh tokens)
 *   - auth.middleware   GET  /api/v1/auth/me       (per-request JWT verify)
 *
 * The auth hot path is dominated by bcrypt (cost factor controlled by
 * BCRYPT_WORK_FACTOR). Per the ADR 0021 SLO clarification, the bench runs
 * at factor 10 — production accepts up to factor 12 in exchange for
 * stronger hashes; the platform also offers a worker-thread offload so
 * factor 12 never blocks the event loop in production.
 *
 * Importantly, the production rate limiters cap login at 5 / 15 min and
 * refresh at 30 / 15 min per IP. We replace them with permissive limiters
 * for the bench by re-mounting the auth router with no-op rate limit
 * middlewares.
 */

import express from 'express';
import request from 'supertest';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { bootstrap } from '../../../src/backend/bootstrap/main.js';
import { buildAuthRouter } from '../../../src/backend/contexts/identity-and-access/interfaces/http/auth-router.js';
import { runStandalone } from '../runner.js';

const REGISTER_WARMUP = 5;
const REGISTER_ITERS = 50;
const LOGIN_WARMUP = 5;
const LOGIN_ITERS = 50;
const REFRESH_WARMUP = 10;
const REFRESH_ITERS = 200;
const MIDDLEWARE_WARMUP = 100;
const MIDDLEWARE_ITERS = 1000;

/* ---------------- bootstrap helper ---------------- */

export async function bootBenchApp() {
  const booted = await bootstrap({
    JWT_SECRET: 'bench-secret-change-me',
    LOG_LEVEL: 'error',
    // Bench uses factor 10 (a measured-acceptable middle ground for
    // production hardware). Production retains factor 12 + worker-thread
    // offload — see docs/adr/0021-observability.md and
    // src/backend/contexts/identity-and-access/infrastructure/crypto/.
    BCRYPT_WORK_FACTOR: '10',
    DATABASE_URL: undefined,
    REDIS_URL: undefined,
  });

  // Build a parallel express app that re-mounts the auth router with
  // permissive rate limiters so we can hammer login/refresh without the
  // 5-per-15-min ADR 0015 cap kicking in. This is a measurement-only
  // accommodation; production keeps the strict limits.
  const noopLimiter = (_req, _res, next) => next();
  const benchAuthRouter = buildAuthRouter({
    useCases: booted.ctx.identity.useCases,
    tokenIssuer: booted.ctx.identity.tokenIssuer,
    tokenBlacklist: booted.ctx.identity.tokenBlacklist,
    loginRateLimit: noopLimiter,
    refreshRateLimit: noopLimiter,
  });
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1/auth', benchAuthRouter);

  return { booted, app };
}

/* ---------------- helpers ---------------- */

function freshEmail() {
  return `bench-${randomUUID()}@example.com`;
}

function freshUsername() {
  // Username VO requires alpha-first; keep it simple.
  return `bench${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const REGISTER_PASSWORD = 'BenchPassword!1';

async function registerOnce(app) {
  const body = {
    email: freshEmail(),
    username: freshUsername(),
    password: REGISTER_PASSWORD,
    role: 'user',
    fullName: 'Bench User',
  };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  if (res.status !== 201) {
    throw new Error(`register failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { credentials: body, registered: res.body };
}

async function loginOnce(app, identifier) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier, password: REGISTER_PASSWORD });
  if (res.status !== 200) {
    throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function refreshOnce(app, refreshToken) {
  const res = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken });
  if (res.status !== 200) {
    throw new Error(`refresh failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function meOnce(app, accessToken) {
  const res = await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${accessToken}`);
  if (res.status !== 200) {
    throw new Error(`me failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/* ---------------- bench builder ---------------- */

/**
 * @param {{ booted: Awaited<ReturnType<typeof bootstrap>>, app: import('express').Express }} env
 */
export function buildAuthBenches({ booted, app }) {
  // Pre-state used by the warm benches.
  let loginIdentifier = null;
  let refreshChain = null;       // mutable: each iteration consumes & rotates
  let middlewareToken = null;

  return [
    {
      name: 'auth.register',
      warmup: REGISTER_WARMUP,
      iterations: REGISTER_ITERS,
      async fn() {
        await registerOnce(app);
      },
    },

    {
      name: 'auth.login',
      warmup: LOGIN_WARMUP,
      iterations: LOGIN_ITERS,
      async setup() {
        const { credentials } = await registerOnce(app);
        loginIdentifier = credentials.email;
      },
      async fn() {
        await loginOnce(app, loginIdentifier);
      },
    },

    {
      name: 'auth.refresh',
      warmup: REFRESH_WARMUP,
      iterations: REFRESH_ITERS,
      async setup() {
        const { credentials } = await registerOnce(app);
        const session = await loginOnce(app, credentials.email);
        refreshChain = { token: session.refreshToken };
      },
      async fn() {
        // Refresh rotates the token; thread the latest into the next call.
        const out = await refreshOnce(app, refreshChain.token);
        refreshChain.token = out.refreshToken;
      },
    },

    {
      name: 'auth.middleware',
      warmup: MIDDLEWARE_WARMUP,
      iterations: MIDDLEWARE_ITERS,
      async setup() {
        const { credentials } = await registerOnce(app);
        const session = await loginOnce(app, credentials.email);
        middlewareToken = session.accessToken;
      },
      async fn() {
        await meOnce(app, middlewareToken);
      },
    },
  ];
}

/* -------------------- standalone entry -------------------- */

async function main() {
  const env = await bootBenchApp();
  try {
    await runStandalone('auth-throughput', () => buildAuthBenches(env));
  } finally {
    await env.booted.shutdown();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('auth-throughput bench failed:', err);
    process.exit(1);
  });
}
