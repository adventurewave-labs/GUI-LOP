import { EmailAddress } from '../../domain/user/email-address.js';
import { Username } from '../../domain/user/username.js';
import { RefreshTokenSecret } from '../../domain/session/refresh-token-secret.js';
import { Session } from '../../domain/session/session.js';
import {
  InvalidCredentialsError,
  UserDeactivatedError,
} from '../../domain/errors.js';
import {
  UserAuthenticated,
  UserAuthenticationFailed,
} from '../../domain/events.js';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACCESS_TTL_S = 15 * 60;

export class AuthenticateUserUseCase {
  constructor({
    userRepository,
    sessionRepository,
    passwordHasher,
    tokenIssuer,
    outbox,
    idGenerator,
    clock,
    refreshTtlMs = REFRESH_TTL_MS,
    accessTtlSeconds = ACCESS_TTL_S,
  }) {
    this.userRepository = userRepository;
    this.sessionRepository = sessionRepository;
    this.passwordHasher = passwordHasher;
    this.tokenIssuer = tokenIssuer;
    this.outbox = outbox;
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.refreshTtlMs = refreshTtlMs;
    this.accessTtlSeconds = accessTtlSeconds;
  }

  /**
   * @param {{ identifier: string, password: string, ip?: string|null, userAgent?: string|null }} cmd
   */
  async execute(cmd) {
    const identifier = String(cmd.identifier ?? '').trim();
    if (!identifier || !cmd.password) {
      throw new InvalidCredentialsError();
    }

    const user = await this._lookup(identifier);
    const now = this.clock.now();

    if (!user) {
      await this._emitFailure(identifier, cmd.ip, 'unknown_user', now);
      throw new InvalidCredentialsError();
    }
    if (!user.isActive) {
      await this._emitFailure(identifier, cmd.ip, 'user_deactivated', now);
      throw new UserDeactivatedError();
    }

    try {
      await user.authenticate(cmd.password, this.passwordHasher);
    } catch (err) {
      await this._emitFailure(identifier, cmd.ip, 'bad_password', now);
      throw err;
    }

    user.recordLogin(now);

    const refreshSecret = RefreshTokenSecret.generate(this.idGenerator);
    const session = Session.issue({
      id: this.idGenerator.newId(),
      userId: user.id,
      refreshTokenHash: refreshSecret.hash(),
      ip: cmd.ip ?? null,
      userAgent: cmd.userAgent ?? null,
      ttlMs: this.refreshTtlMs,
      now,
    });

    const access = await this.tokenIssuer.issueAccess(
      { sub: user.id, role: user.role.value, sid: session.id },
      this.accessTtlSeconds,
    );

    await this.userRepository.save(user);
    await this.sessionRepository.save(session);
    const events = [
      ...user.pullEvents(),
      ...session.pullEvents(),
      new UserAuthenticated({
        userId: user.id,
        sessionId: session.id,
        ip: cmd.ip ?? null,
        occurredAt: now,
      }),
    ];
    await this.outbox.enqueue(events);

    return {
      accessToken: access.token,
      refreshToken: refreshSecret.value,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
      sessionId: session.id,
      user: {
        id: user.id,
        email: user.email.value,
        username: user.username.value,
        role: user.role.value,
      },
    };
  }

  /** @private */
  async _lookup(identifier) {
    if (identifier.includes('@')) {
      try {
        const email = new EmailAddress(identifier);
        return await this.userRepository.findByEmail(email);
      } catch {
        return null;
      }
    }
    try {
      const username = new Username(identifier);
      return await this.userRepository.findByUsername(username);
    } catch {
      return null;
    }
  }

  /** @private */
  async _emitFailure(identifier, ip, reason, now) {
    await this.outbox.enqueue([
      new UserAuthenticationFailed({
        identifier,
        ip: ip ?? null,
        reason,
        occurredAt: now,
      }),
    ]);
  }
}
