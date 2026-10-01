// @ts-check
import { createHash } from 'node:crypto';
import {
  InvalidCredentialsError,
  RefreshTokenReusedError,
  SessionExpiredError,
  SessionRevokedError,
} from '../../domain/errors.js';
import { RefreshTokenSecret } from '../../domain/session/refresh-token-secret.js';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACCESS_TTL_S = 15 * 60;

function hashSecret(plain) {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

export class RefreshSessionUseCase {
  constructor({
    userRepository,
    sessionRepository,
    tokenIssuer,
    outbox,
    idGenerator,
    clock,
    refreshTtlMs = REFRESH_TTL_MS,
    accessTtlSeconds = ACCESS_TTL_S,
  }) {
    this.userRepository = userRepository;
    this.sessionRepository = sessionRepository;
    this.tokenIssuer = tokenIssuer;
    this.outbox = outbox;
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.refreshTtlMs = refreshTtlMs;
    this.accessTtlSeconds = accessTtlSeconds;
  }

  /** @param {{ refreshToken: string }} cmd */
  async execute(cmd) {
    if (!cmd.refreshToken || typeof cmd.refreshToken !== 'string') {
      throw new InvalidCredentialsError('refresh token required');
    }
    const incomingHash = hashSecret(cmd.refreshToken);
    const session = await this.sessionRepository.findByRefreshTokenHash(incomingHash);
    const now = this.clock.now();
    if (!session) {
      // Not the current token. If it is one this session already rotated
      // away, it has been replayed — assume it leaked and kill the session
      // (every descendant token with it). RFC 9700 §4.14.2.
      const reused = await this.sessionRepository.findBySupersededRefreshTokenHash?.(incomingHash);
      if (reused) {
        reused.revokeForReuse(now);
        await this.sessionRepository.save(reused);
        await this.outbox.enqueue(reused.pullEvents());
        throw new RefreshTokenReusedError();
      }
      throw new InvalidCredentialsError();
    }

    if (!session.isActive) throw new SessionRevokedError();
    if (!session.isUsable(now)) throw new SessionExpiredError();

    const user = await this.userRepository.findById(session.userId);
    if (!user || !user.isActive) {
      throw new InvalidCredentialsError();
    }

    const newSecret = RefreshTokenSecret.generate(this.idGenerator);
    session.refresh(newSecret.hash(), now, this.refreshTtlMs);

    const access = await this.tokenIssuer.issueAccess(
      { sub: user.id, role: user.role.value, sid: session.id },
      this.accessTtlSeconds,
    );

    await this.sessionRepository.save(session);
    await this.outbox.enqueue(session.pullEvents());

    return {
      accessToken: access.token,
      refreshToken: newSecret.value,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
      sessionId: session.id,
    };
  }
}
