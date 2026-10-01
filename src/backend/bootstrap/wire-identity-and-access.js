// @ts-check
/**
 * wire-identity-and-access.js — composition for the Identity & Access context.
 *
 * Exposes a `wireIdentityAndAccess({ pool, redis, clock, idGen, config })`
 * helper that returns the use cases, ports, and HTTP router needed by the
 * composition root. Picks Postgres adapters when `pool` is non-null, else
 * falls back to in-memory.
 */
import { PasswordPolicy } from '../contexts/identity-and-access/domain/user/password-policy.js';
import { isCommonPassword } from '../contexts/identity-and-access/infrastructure/password-blocklist/common-passwords.js';
import { identifierKey, ipBucket } from '../shared-kernel/infrastructure/rate-limiters.js';
import { InMemoryUserRepository } from '../contexts/identity-and-access/infrastructure/persistence/inmemory-user-repository.js';
import { InMemorySessionRepository } from '../contexts/identity-and-access/infrastructure/persistence/inmemory-session-repository.js';
import { InMemoryGrantsRepository } from '../contexts/identity-and-access/infrastructure/persistence/inmemory-grants-repository.js';
import { InMemoryApiKeyRepository } from '../contexts/identity-and-access/infrastructure/persistence/inmemory-api-key-repository.js';
import { PgUserRepository } from '../contexts/identity-and-access/infrastructure/persistence/pg-user-repository.js';
import { PgSessionRepository } from '../contexts/identity-and-access/infrastructure/persistence/pg-session-repository.js';
import { PgGrantsRepository } from '../contexts/identity-and-access/infrastructure/persistence/pg-grants-repository.js';
import { PgRoleRepository } from '../contexts/identity-and-access/infrastructure/persistence/pg-role-repository.js';
import { PgApiKeyRepository } from '../contexts/identity-and-access/infrastructure/persistence/pg-api-key-repository.js';
import { PgHttpIdempotencyStore } from '../shared-kernel/infrastructure/http-idempotency.js';
import { withAccessTokenRevocation } from '../contexts/identity-and-access/application/services/access-token-revocation.js';
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
import { MintApiKeyUseCase } from '../contexts/identity-and-access/application/commands/mint-api-key.js';
import { RevokeApiKeyUseCase } from '../contexts/identity-and-access/application/commands/revoke-api-key.js';
import { AuthenticateWithApiKeyUseCase } from '../contexts/identity-and-access/application/commands/authenticate-with-api-key.js';
import { DeactivateUserUseCase } from '../contexts/identity-and-access/application/commands/deactivate-user.js';
import { ReactivateUserUseCase } from '../contexts/identity-and-access/application/commands/reactivate-user.js';
import { GetUserProfileQuery } from '../contexts/identity-and-access/application/queries/get-user-profile.js';
import { ListApiKeysForUserQuery } from '../contexts/identity-and-access/application/queries/list-api-keys-for-user.js';
import { ListUsersQuery } from '../contexts/identity-and-access/application/queries/list-users.js';

import { buildAuthRouter } from '../contexts/identity-and-access/interfaces/http/auth-router.js';
import { buildApiKeyRouter } from '../contexts/identity-and-access/interfaces/http/api-key-router.js';
import { buildAdminRouter } from '../contexts/identity-and-access/interfaces/http/admin-router.js';
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
      ['viewer', new Set(['workflow:read'])], // matches migration 015 (was missing: viewers had no permissions in dev)
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

/**
 * ADR 0015 auth limits. All fail closed: if the limiter store is down we
 * refuse auth traffic rather than allow unlimited guessing.
 */
export function buildAuthLimiters(create) {
  const FIFTEEN_MIN = 15 * 60 * 1000;
  return {
    loginIp: create('login-ip', {
      windowMs: FIFTEEN_MIN, limit: 20, failClosed: true, message: 'Too many login attempts',
    }),
    loginIdentifier: create('login-id', {
      windowMs: FIFTEEN_MIN,
      limit: 5,
      failClosed: true,
      // Only failures count, so a legitimate user isn't locked out by their
      // own successful logins; keyed on a hash of the normalised identifier.
      skipSuccessfulRequests: true,
      keyGenerator: (req) => {
        const raw = req.body?.identifier ?? req.body?.email ?? req.body?.username;
        return `id:${identifierKey(raw) ?? `ip:${ipBucket(req.ip)}`}`;
      },
      message: 'Too many failed login attempts for this account',
    }),
    refresh: create('refresh', {
      windowMs: FIFTEEN_MIN, limit: 30, failClosed: true, message: 'Too many refresh attempts',
    }),
    register: create('register', {
      windowMs: 60 * 60 * 1000, limit: 5, failClosed: true, message: 'Too many registrations',
    }),
    password: create('password', {
      windowMs: FIFTEEN_MIN,
      limit: 5,
      failClosed: true,
      keyGenerator: (req) => `user:${req.principal?.userId ?? ipBucket(req.ip)}`,
      message: 'Too many password change attempts',
    }),
  };
}

export function wireIdentityAndAccess({ pool, redis, clock, idGen, config, logger, rateLimiter }) {
  const userRepository = pool ? new PgUserRepository(pool) : new InMemoryUserRepository();
  const sessionStore = pool
    ? new PgSessionRepository(pool)
    : new InMemorySessionRepository();
  const roleRepository = pool ? new PgRoleRepository(pool) : new InMemoryRoleRepository();
  // Direct grants must be durable and shared across pods (migration 009);
  // the in-memory repository is for dev/test only.
  const grantsRepository = pool ? new PgGrantsRepository(pool) : new InMemoryGrantsRepository();
  const apiKeyRepository = pool
    ? new PgApiKeyRepository(pool)
    : new InMemoryApiKeyRepository();
  const tokenBlacklist = redis
    ? new RedisTokenBlacklist(redis)
    : new InMemoryTokenBlacklist();
  // Revoking a session (logout, refresh-token reuse, …) also revokes every
  // access token already issued for it, for one access-token lifetime.
  const sessionRepository = withAccessTokenRevocation(sessionStore, tokenBlacklist, {
    accessTtlSeconds: config?.JWT_ACCESS_TTL_SECONDS ?? 15 * 60,
  });
  const passwordHasher = new BcryptPasswordHasher({ rounds: config.BCRYPT_WORK_FACTOR });
  const tokenIssuer = new JwtTokenIssuer({ secret: config.JWT_SECRET });
  const outbox = new IdentityInMemoryOutbox();

  const deps = {
    userRepository,
    sessionRepository,
    roleRepository,
    grantsRepository,
    apiKeyRepository,
    passwordHasher,
    tokenIssuer,
    tokenBlacklist,
    outbox,
    idGenerator: idGen,
    clock,
    accessTtlSeconds: config.JWT_ACCESS_TTL_SECONDS,
    refreshTtlSeconds: config.JWT_REFRESH_TTL_SECONDS,
    passwordPolicy: new PasswordPolicy({ minLength: config.PASSWORD_MIN_LENGTH, isCommon: isCommonPassword }),
  };

  const useCases = {
    registerUser: new RegisterUserUseCase(deps),
    authenticateUser: new AuthenticateUserUseCase(deps),
    refreshSession: new RefreshSessionUseCase(deps),
    revokeSession: new RevokeSessionUseCase(deps),
    changePassword: new ChangePasswordUseCase(deps),
    grantPermission: new GrantPermissionUseCase(deps),
    revokePermission: new RevokePermissionUseCase(deps),
    mintApiKey: new MintApiKeyUseCase(deps),
    revokeApiKey: new RevokeApiKeyUseCase(deps),
    authenticateWithApiKey: new AuthenticateWithApiKeyUseCase(deps),
    listApiKeysForUser: new ListApiKeysForUserQuery(deps),
    deactivateUser: new DeactivateUserUseCase(deps),
    reactivateUser: new ReactivateUserUseCase(deps),
    getUserProfile: new GetUserProfileQuery(deps),
    listUsers: new ListUsersQuery(deps),
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
    limiters: rateLimiter ? buildAuthLimiters(rateLimiter) : undefined,
    // Shared across replicas when Postgres is configured (a retry that lands
    // on another pod must replay, not re-register).
    idempotencyStore: pool ? new PgHttpIdempotencyStore(pool) : undefined,
  });

  const authMiddleware = makeAuthMiddleware({
    tokenIssuer,
    tokenBlacklist,
    authenticateWithApiKey: useCases.authenticateWithApiKey,
  });

  const apiKeyRouter = buildApiKeyRouter({
    useCases,
    requireAuth: authMiddleware,
  });

  const adminRouter = buildAdminRouter({
    useCases,
    requireAuth: authMiddleware,
  });

  if (logger) {
    logger.info(
      `identity-and-access wired (${pool ? 'pg' : 'in-memory'} repos, ${
        redis ? 'redis' : 'in-memory'
      } token blacklist, api-keys + admin routers active)`,
    );
  }

  return {
    useCases,
    router,
    apiKeyRouter,
    adminRouter,
    authMiddleware,
    authorisationService,
    tokenIssuer,
    tokenBlacklist,
    outbox,
    repositories: {
      userRepository,
      sessionRepository,
      roleRepository,
      grantsRepository,
      apiKeyRepository,
    },
  };
}
