import { RegisterUserUseCase } from '../../application/commands/register-user.js';
import { AuthenticateUserUseCase } from '../../application/commands/authenticate-user.js';
import { RefreshSessionUseCase } from '../../application/commands/refresh-session.js';
import { RevokeSessionUseCase } from '../../application/commands/revoke-session.js';
import {
  InvalidCredentialsError,
  SessionExpiredError,
  SessionRevokedError,
} from '../../domain/errors.js';
import { NotFoundError } from '../../../../shared-kernel/domain/errors.js';
import { makeFixtures } from './test-fixtures.js';

async function login(f) {
  const reg = new RegisterUserUseCase(f);
  await reg.execute({ email: 'a@b.com', username: 'alice', password: 'longenuf1' });
  const auth = new AuthenticateUserUseCase(f);
  return auth.execute({ identifier: 'alice', password: 'longenuf1' });
}

describe('RefreshSessionUseCase', () => {
  test('rotates refresh token and emits session.refreshed', async () => {
    const f = makeFixtures();
    const first = await login(f);
    f.outbox.events.length = 0;
    const refresh = new RefreshSessionUseCase(f);
    f.clock.advance(1000);
    const next = await refresh.execute({ refreshToken: first.refreshToken });
    expect(next.refreshToken).not.toBe(first.refreshToken);
    expect(f.outbox.events.map((e) => e.eventType)).toContain('session.refreshed');
  });

  test('rejects unknown refresh token', async () => {
    const f = makeFixtures();
    await login(f);
    const refresh = new RefreshSessionUseCase(f);
    await expect(
      refresh.execute({ refreshToken: 'a'.repeat(64) }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  test('rejects after revocation', async () => {
    const f = makeFixtures();
    const first = await login(f);
    const revoke = new RevokeSessionUseCase(f);
    await revoke.execute({ sessionId: first.sessionId });
    const refresh = new RefreshSessionUseCase(f);
    await expect(
      refresh.execute({ refreshToken: first.refreshToken }),
    ).rejects.toThrow(SessionRevokedError);
  });

  test('rejects expired session', async () => {
    const f = makeFixtures();
    const first = await login(f);
    f.clock.advance(8 * 24 * 60 * 60 * 1000);
    const refresh = new RefreshSessionUseCase(f);
    await expect(
      refresh.execute({ refreshToken: first.refreshToken }),
    ).rejects.toThrow(SessionExpiredError);
  });
});

describe('RevokeSessionUseCase', () => {
  test('revokes existing session and blacklists access token', async () => {
    const f = makeFixtures();
    const first = await login(f);
    f.outbox.events.length = 0;
    const revoke = new RevokeSessionUseCase(f);
    await revoke.execute({ sessionId: first.sessionId, accessJti: 'jti-1', accessTtlSeconds: 60 });
    expect(f.outbox.events.map((e) => e.eventType)).toContain('session.revoked');
    expect(await f.tokenBlacklist.isBlacklisted('jti-1')).toBe(true);
  });

  test('throws when session not found', async () => {
    const f = makeFixtures();
    const revoke = new RevokeSessionUseCase(f);
    await expect(revoke.execute({ sessionId: 'missing' })).rejects.toThrow(NotFoundError);
  });
});
