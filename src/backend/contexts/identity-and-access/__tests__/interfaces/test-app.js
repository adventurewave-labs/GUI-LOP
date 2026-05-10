import express from 'express';
import { buildAuthRouter } from '../../interfaces/http/auth-router.js';
import { RegisterUserUseCase } from '../../application/commands/register-user.js';
import { AuthenticateUserUseCase } from '../../application/commands/authenticate-user.js';
import { RefreshSessionUseCase } from '../../application/commands/refresh-session.js';
import { RevokeSessionUseCase } from '../../application/commands/revoke-session.js';
import { ChangePasswordUseCase } from '../../application/commands/change-password.js';
import { GetUserProfileQuery } from '../../application/queries/get-user-profile.js';
import { makeFixtures } from '../application/test-fixtures.js';

/**
 * Build an Express app wired with in-memory adapters for HTTP tests.
 * Returns `{ app, fixtures }` so tests can introspect the in-memory state.
 *
 * Rate limiters are disabled in tests by passing pass-through middlewares.
 */
export function buildTestApp() {
  const fixtures = makeFixtures();
  const useCases = {
    registerUser: new RegisterUserUseCase(fixtures),
    authenticateUser: new AuthenticateUserUseCase(fixtures),
    refreshSession: new RefreshSessionUseCase(fixtures),
    revokeSession: new RevokeSessionUseCase(fixtures),
    changePassword: new ChangePasswordUseCase(fixtures),
    getUserProfile: new GetUserProfileQuery(fixtures),
  };

  const router = buildAuthRouter({
    useCases,
    tokenIssuer: fixtures.tokenIssuer,
    tokenBlacklist: fixtures.tokenBlacklist,
    loginRateLimit: (req, _res, next) => next(),
    refreshRateLimit: (req, _res, next) => next(),
  });

  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', router);
  return { app, fixtures, useCases };
}
