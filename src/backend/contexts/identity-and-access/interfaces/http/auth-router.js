import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sendError } from './error-mapper.js';
import { makeAuthMiddleware } from './auth-middleware.js';
import {
  InMemoryIdempotencyStore,
  makeIdempotencyMiddleware,
} from './idempotency-middleware.js';

/**
 * Build the Express router for the Identity & Access context.
 *
 * Required deps:
 *   useCases: {
 *     registerUser, authenticateUser, refreshSession,
 *     revokeSession, changePassword, getUserProfile
 *   }
 *   tokenIssuer, tokenBlacklist
 *
 * Optional:
 *   idempotencyStore (defaults to in-memory)
 *   loginRateLimit / refreshRateLimit (override the per-IP limiters)
 *   limiters: { loginIp, loginIdentifier, refresh, register, password }
 *     — built by the shared-kernel rate-limiter factory in the composition
 *     root (Redis-backed in production). Missing entries fall back to the
 *     legacy in-memory per-IP limiters (login/refresh) or pass-through.
 */
export function buildAuthRouter({
  useCases,
  tokenIssuer,
  tokenBlacklist,
  idempotencyStore,
  loginRateLimit,
  refreshRateLimit,
  limiters = {},
} = {}) {
  if (!useCases) throw new Error('useCases required');
  const router = Router();

  const requireAuth = makeAuthMiddleware({ tokenIssuer, tokenBlacklist });
  const idemStore = idempotencyStore ?? new InMemoryIdempotencyStore();
  const idem = makeIdempotencyMiddleware({ store: idemStore });

  // ADR 0015 — strict per-IP limits on login/refresh; auth fails closed.
  const passthrough = (_req, _res, next) => next();
  const loginLimiter = loginRateLimit ?? limiters.loginIp ?? rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Too many login attempts' },
  });
  // Per-account failed-attempt budget: stops distributed credential
  // stuffing against one identifier that per-IP limits can't see.
  const loginIdentifierLimiter = limiters.loginIdentifier ?? passthrough;
  const registerLimiter = limiters.register ?? passthrough;
  const passwordLimiter = limiters.password ?? passthrough;
  const refreshLimiter = refreshRateLimit ?? limiters.refresh ?? rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Too many refresh attempts' },
  });

  router.post('/register', registerLimiter, idem, async (req, res) => {
    try {
      const out = await useCases.registerUser.execute(req.body ?? {});
      res.status(201).json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/login', loginLimiter, loginIdentifierLimiter, async (req, res) => {
    try {
      const out = await useCases.authenticateUser.execute({
        identifier: req.body?.identifier ?? req.body?.email ?? req.body?.username,
        password: req.body?.password,
        ip: req.ip ?? null,
        userAgent: req.headers?.['user-agent'] ?? null,
      });
      res.status(200).json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/refresh', refreshLimiter, async (req, res) => {
    try {
      const out = await useCases.refreshSession.execute({
        refreshToken: req.body?.refreshToken,
      });
      res.status(200).json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/logout', requireAuth, async (req, res) => {
    try {
      await useCases.revokeSession.execute({
        sessionId: req.principal.sessionId,
        accessJti: req.principal.jti,
      });
      res.status(204).end();
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/password', requireAuth, passwordLimiter, idem, async (req, res) => {
    try {
      await useCases.changePassword.execute({
        userId: req.principal.userId,
        oldPassword: req.body?.oldPassword,
        newPassword: req.body?.newPassword,
      });
      res.status(204).end();
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get('/me', requireAuth, async (req, res) => {
    try {
      const profile = await useCases.getUserProfile.execute({
        userId: req.principal.userId,
      });
      res.status(200).json(profile);
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
