import { RegisterUserUseCase } from '../../application/commands/register-user.js';
import { ConflictError } from '../../shared-kernel-stubs.js';
import { makeFixtures } from './test-fixtures.js';

describe('RegisterUserUseCase', () => {
  test('happy path creates user, hashes password, emits user.registered', async () => {
    const f = makeFixtures();
    const uc = new RegisterUserUseCase(f);
    const out = await uc.execute({
      email: 'Alice@Example.com',
      username: 'alice',
      password: 'super-secret-pw',
    });
    expect(out).toMatchObject({ email: 'alice@example.com', username: 'alice', role: 'user' });
    expect(await f.userRepository.findById(out.id)).not.toBeNull();
    const events = f.outbox.events;
    expect(events.map((e) => e.eventType)).toContain('user.registered');
  });

  test('conflict on duplicate email', async () => {
    const f = makeFixtures();
    const uc = new RegisterUserUseCase(f);
    await uc.execute({ email: 'a@b.com', username: 'alice', password: 'longenuf1' });
    await expect(
      uc.execute({ email: 'a@b.com', username: 'bob', password: 'longenuf1' }),
    ).rejects.toThrow(ConflictError);
  });

  test('rejects short password', async () => {
    const f = makeFixtures();
    const uc = new RegisterUserUseCase(f);
    await expect(
      uc.execute({ email: 'x@y.com', username: 'xy-user', password: 'short' }),
    ).rejects.toThrow(/at least 8 characters/);
  });
});
