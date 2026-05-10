/**
 * wire-identity-and-access.js — composition for the Identity & Access context.
 *
 * Exposes a `wireIdentityAndAccess({ pool, redis, clock, idGen, config })`
 * helper that returns the use cases, ports, and HTTP router needed by the
 * composition root. Picks Postgres adapters when `pool` is non-null, else
 * falls back to in-memory.
 */
import { InMemoryUserRepository } from '../contexts/identity-and-access/infrastructure/persistence/inmemory-user-repository.js';
import { InMemorySessionRepository } from '../contexts/identity-and-access/infrastructure/persistence/inmemory-session-repository.js';
import { InMemoryGrantsRepository } from '../contexts/identity-and-access/infrastructure/persistence/inmemory-grants-repository.js';
import { PgUserRepository } from '../contexts/identity-and-access/infrastructure/persistence/pg-user-repository.js';
import { PgSessionRepository } from '../contexts/identity-and-access/infrastructure/persistence/pg-session-repository.js';
import { PgRoleRepository } from '../contexts/identity-and-access/infrastructure/persistence/pg-role-repository.js';
import { InMemoryTokenBlacklist } from '../contexts/identity-and-access/infrastructure/cache/inmemory-token-blacklist.js';
import { RedisTokenBlacklist } from '../contexts/identity-and-access/infrastructure/cache/redis-token-blacklist.js';
import { BcryptPasswordHasher } from '../contexts/identity-and-access/infrastructure/crypto/bcrypt-password-hasher.js';
import { JwtTokenIssuer } from '../contexts/identity-and-access/infrastructure/tokens/jwt-token-issuer.js';
import { InMemoryOutbox as IdentityInMemoryOutbox } from '../contexts/identity-and-access/application/ports/outbox.js';
import { AuthorisationService as IdentityAuthorisationService } from '../contexts/identity-and-access/application/services/authorisation-service.js';
import { Permission } from '../contexts/identity-and-access/domain/permission/permission.js';

import { RegisterUserUseCase } from '../contexts/identity-and-access/application/commands/register-user.js';
import { AuthenticateUserUseCase } from '../contexts/identity-and-access/application/commands/authenticate-user.js';
import { RefreshSessionUseCase } from '../contexts/identity-and-access/application/commands/refresh-session.js';
import { RevokeSessionUseCase } from '../contexts/identity-and-access/application/commands/revoke-session.js';
import { ChangePasswordUseCase } from '../contexts/identity-and-access/application/commands/change-password.js';
import { GrantPermissionUseCase } from '../contexts/identity-and-access/application/commands/grant-permission.js';
import { RevokePermissionUseCase } from '../contexts/identity-and-access/application/commands/revoke-permission.js';
import { GetUserProfileQuery } from '../contexts/identity-and-access/application/queries/get-user-profile.js';

import { buildAuthRouter } from '../contexts/identity-and-access/interfaces/http/auth-router.js';
import { makeAuthMiddleware } from '../contexts/identity-and-access/interfaces/http/auth-middleware.js';

/**
 * Tiny in-process role repository used when no Postgres pool is configured.
 * Hardcodes the same role -> permissions matrix the legacy server uses so
 * dev mode behaves predictably.
 */
class InMemoryRoleRepository {
  constructor() {
    this._roles = new Map([
      ['admin', new Set([])], // admins implicitly hold every permission
      ['user', new Set(['workflow:read', 'workflow:create', 'workflow:respond'])],
      ['reviewer', new Set(['workflow:read', 'workflow:respond'])],
      ['analyst', new Set(['workflow:read'])],
    ]);
  }
  async findByName(name) {
    const set = this._roles.get(name);
    if (!set) return null;
    return {
      name,
      permissions: [...set].map((p) => new Permission(p)),
    };
  }
  async list() {
    return [...this._roles.entries()].map(([name, set]) => ({
      name,
      permissions: [...set].map((p) => new Permission(p)),
    }));
  }
}

export function wireIdentityAndAccess({ pool, redis, clock, idGen, config, logger }) {
  const userRepository = pool ? new PgUserRepository(pool) : new InMemoryUserRepository();
  const sessionRepository = pool
    ? new PgSessionRepository(pool)
    : new InMemorySessionRepository();
  const roleRepository = pool ? new PgRoleRepository(pool) : new InMemoryRoleRepository();
  const grantsRepository = new InMemoryGrantsRepository();
  const tokenBlacklist = redis
    ? new RedisTokenBlacklist(redis)
    : new InMemoryTokenBlacklist();
  const passwordHasher = new BcryptPasswordHasher({ rounds: config.BCRYPT_WORK_FACTOR });
  const tokenIssuer = new JwtTokenIssuer({ secret: config.JWT_SECRET });
  const outbox = new IdentityInMemoryOutbox();

  const deps = {
    userRepository,
    sessionRepository,
    roleRepository,
    grantsRepository,
    passwordHasher,
    tokenIssuer,
    tokenBlacklist,
    outbox,
    idGenerator: idGen,
    clock,
    accessTtlSeconds: config.JWT_ACCESS_TTL_SECONDS,
    refreshTtlSeconds: config.JWT_REFRESH_TTL_SECONDS,
  };

  const useCases = {
    registerUser: new RegisterUserUseCase(deps),
    authenticateUser: new AuthenticateUserUseCase(deps),
    refreshSession: new RefreshSessionUseCase(deps),
    revokeSession: new RevokeSessionUseCase(deps),
    changePassword: new ChangePasswordUseCase(deps),
    grantPermission: new GrantPermissionUseCase(deps),
    revokePermission: new RevokePermissionUseCase(deps),
    getUserProfile: new GetUserProfileQuery(deps),
  };

  const authorisationService = new IdentityAuthorisationService({
    userRepository,
    roleRepository,
    grantsRepository,
  });

  const router = buildAuthRouter({
    useCases,
    tokenIssuer,
    tokenBlacklist,
  });

  const authMiddleware = makeAuthMiddleware({ tokenIssuer, tokenBlacklist });

  if (logger) {
    logger.info(
      `identity-and-access wired (${pool ? 'pg' : 'in-memory'} repos, ${
        redis ? 'redis' : 'in-memory'
      } token blacklist)`,
    );
  }

  return {
    useCases,
    router,
    authMiddleware,
    authorisationService,
    tokenIssuer,
    tokenBlacklist,
    outbox,
    repositories: { userRepository, sessionRepository, roleRepository, grantsRepository },
  };
}
