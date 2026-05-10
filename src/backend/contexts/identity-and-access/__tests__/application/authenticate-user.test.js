import { RegisterUserUseCase } from '../../application/commands/register-user.js';
import { AuthenticateUserUseCase } from '../../application/commands/authenticate-user.js';
import {
  InvalidCredentialsError,
  UserDeactivatedError,
} from '../../domain/errors.js';
import { makeFixtures } from './test-fixtures.js';

async function seedUser(f, password = 'hunter2-pw') {
  const reg = new RegisterUserUseCase(f);
  return reg.execute({
    email: 'alice@example.com',
    username: 'alice',
    password,
  });
}

describe('AuthenticateUserUseCase', () => {
  test('happy path issues access + refresh tokens, emits user.authenticated', async () => {
    const f = makeFixtures();
    await seedUser(f);
    const auth = new AuthenticateUserUseCase(f);
    const out = await auth.execute({
      identifier: 'alice@example.com',
      password: 'hunter2-pw',
      ip: '1.2.3.4',
      userAgent: 'jest',
    });
    expect(out.accessToken).toEqual(expect.any(String));
    expect(out.refreshToken).toMatch(/^[a-f0-9]{64}$/);
    expect(out.user.username).toBe('alice');
    const types = f.outbox.events.map((e) => e.eventType);
    expect(types).toContain('user.authenticated');
    expect(types).toContain('session.created');
  });

  test('login by username works', async () => {
    const f = makeFixtures();
    await seedUser(f);
    const auth = new AuthenticateUserUseCase(f);
    const out = await auth.execute({ identifier: 'alice', password: 'hunter2-pw' });
    expect(out.user.id).toBeTruthy();
  });

  test('wrong password emits failure event and throws', async () => {
    const f = makeFixtures();
    await seedUser(f);
    const auth = new AuthenticateUserUseCase(f);
    await expect(
      auth.execute({ identifier: 'alice', password: 'wrong' }),
    ).rejects.toThrow(InvalidCredentialsError);
    expect(f.outbox.events.map((e) => e.eventType)).toContain(
      'user.authentication_failed',
    );
  });

  test('unknown user is treated as invalid credentials', async () => {
    const f = makeFixtures();
    const auth = new AuthenticateUserUseCase(f);
    await expect(
      auth.execute({ identifier: 'ghost@example.com', password: 'whatever' }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  test('deactivated user blocked', async () => {
    const f = makeFixtures();
    const reg = await seedUser(f);
    const u = await f.userRepository.findById(reg.id);
    u.deactivate();
    await f.userRepository.save(u);
    const auth = new AuthenticateUserUseCase(f);
    await expect(
      auth.execute({ identifier: 'alice', password: 'hunter2-pw' }),
    ).rejects.toThrow(UserDeactivatedError);
  });
});
